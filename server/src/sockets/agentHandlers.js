import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import {
  saveMessage,
  markConversationAsRead,
  getWorkspaceStats
} from '../services/chatService.js';
import { Article } from '../models/Article.js';
import { findRelevantArticles } from '../services/retrievalService.js';
import { suggestReply, summarizeConversation } from '../services/aiAssist.js';
import { env } from '../config/env.js';
import { checkAgentAiCooldown } from '../services/rateLimiter.js';
import { mapAiErrorToMessage } from '../utils/errors.js';

// Verifies that the conversation exists and belongs to the agent's workspace
async function verifyAgentConversation(conversationId, workspaceId) {
  if (!conversationId) return null;
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return null;
  if (conversation.workspace.toString() !== workspaceId.toString()) {
    return null;
  }
  return conversation;
}

export function registerAgentHandlers(io, socket) {
  const user = socket.data.user;
  const workspaceId = user?.workspace?._id?.toString() || user?.workspace?.toString();

  // agent:open -> agent opens a conversation to view and reply
  socket.on('agent:open', async (data = {}) => {
    try {
      const { conversationId } = data;
      const conversation = await verifyAgentConversation(conversationId, workspaceId);
      if (!conversation) {
        socket.emit('app:error', { message: 'Conversation not found or access denied' });
        return;
      }

      const convRoom = `conv:${conversationId}`;
      socket.join(convRoom);

      // Mark unread messages as read
      const updatedConv = await markConversationAsRead(conversationId);
      const messages = await Message.find({ conversation: conversationId }).sort({ createdAt: 1 });

      // Reply directly to agent socket
      socket.emit('agent:opened', {
        conversation: updatedConv,
        messages
      });

      // Notify the room that messages were read
      io.to(convRoom).emit('message:read', { conversationId });

      // Notify workspace that unread counts changed
      const wsRoom = `ws:${workspaceId}`;
      io.to(wsRoom).emit('conversation:updated', updatedConv);
    } catch (err) {
      console.error('[Agent Socket Error: agent:open]', err.message);
      socket.emit('app:error', { message: err.message || 'Failed to open conversation' });
    }
  });

  // agent:message -> sends an agent reply
  socket.on('agent:message', async (data = {}) => {
    try {
      const { conversationId, text } = data;
      const conversation = await verifyAgentConversation(conversationId, workspaceId);
      if (!conversation) {
        socket.emit('app:error', { message: 'Conversation not found or access denied' });
        return;
      }

      if (conversation.status === 'closed') {
        socket.emit('app:error', { message: 'Cannot reply to a closed conversation' });
        return;
      }

      const { message, conversation: updatedConv } = await saveMessage({
        conversationId,
        senderType: 'agent',
        senderName: user.username,
        text,
        agentId: user._id
      });

      const convRoom = `conv:${conversationId}`;
      const wsRoom = `ws:${workspaceId}`;

      // Emit new message to conversation room and workspace room
      io.to(convRoom).to(wsRoom).emit('message:new', message);

      // Emit updated conversation and live stats to workspace agents
      const populated = await Conversation.findById(conversationId).populate('assignee', 'username email');
      io.to(wsRoom).emit('conversation:updated', populated);

      const stats = await getWorkspaceStats(workspaceId);
      io.to(wsRoom).emit('stats:update', stats);
    } catch (err) {
      console.error('[Agent Socket Error: agent:message]', err.message);
      socket.emit('app:error', { message: err.message || 'Failed to send agent message' });
    }
  });

  // agent:typing -> relays agent typing indicator to conversation room
  socket.on('agent:typing', async (data = {}) => {
    try {
      const { conversationId, typing } = data;
      const conversation = await verifyAgentConversation(conversationId, workspaceId);
      if (!conversation) return;

      const convRoom = `conv:${conversationId}`;
      socket.to(convRoom).emit('typing', {
        from: 'agent',
        agentName: user.username,
        typing: Boolean(typing)
      });
    } catch (err) {
      console.error('[Agent Socket Error: agent:typing]', err.message);
    }
  });

  // agent:claim -> claims unassigned conversation
  socket.on('agent:claim', async (data = {}) => {
    try {
      const { conversationId } = data;
      const conversation = await verifyAgentConversation(conversationId, workspaceId);
      if (!conversation) {
        socket.emit('app:error', { message: 'Conversation not found or access denied' });
        return;
      }

      conversation.assignee = user._id;
      await conversation.save();

      const populated = await Conversation.findById(conversationId).populate('assignee', 'username email');
      const wsRoom = `ws:${workspaceId}`;

      io.to(wsRoom).emit('conversation:updated', populated);

      const stats = await getWorkspaceStats(workspaceId);
      io.to(wsRoom).emit('stats:update', stats);
    } catch (err) {
      console.error('[Agent Socket Error: agent:claim]', err.message);
      socket.emit('app:error', { message: err.message || 'Failed to claim conversation' });
    }
  });

  // agent:close -> closes conversation, triggers async AI summary
  socket.on('agent:close', async (data = {}) => {
    try {
      const { conversationId } = data;
      const conversation = await verifyAgentConversation(conversationId, workspaceId);
      if (!conversation) {
        socket.emit('app:error', { message: 'Conversation not found or access denied' });
        return;
      }

      if (conversation.status === 'closed') {
        return;
      }

      conversation.status = 'closed';
      conversation.closedAt = new Date();
      await conversation.save();

      const convRoom = `conv:${conversationId}`;
      const wsRoom = `ws:${workspaceId}`;

      io.to(convRoom).emit('conversation:closed', { conversationId });

      const populated = await Conversation.findById(conversationId).populate('assignee', 'username email');
      io.to(wsRoom).emit('conversation:updated', populated);

      const stats = await getWorkspaceStats(workspaceId);
      io.to(wsRoom).emit('stats:update', stats);

      // Asynchronously generate conversation summary without blocking response
      (async () => {
        try {
          const messages = await Message.find({ conversation: conversationId }).sort({ createdAt: 1 });
          const summaryResult = await summarizeConversation(messages);

          const convToUpdate = await Conversation.findById(conversationId);
          if (convToUpdate) {
            convToUpdate.summary = summaryResult.summary;
            if (summaryResult.sentiment) {
              convToUpdate.sentiment = summaryResult.sentiment;
            }
            await convToUpdate.save();

            const rePopulated = await Conversation.findById(conversationId).populate('assignee', 'username email');
            io.to(wsRoom).emit('conversation:updated', rePopulated);
          }
        } catch (summaryErr) {
          console.error('[Agent Socket] Async summarization error:', summaryErr.message);
        }
      })();
    } catch (err) {
      console.error('[Agent Socket Error: agent:close]', err.message);
      socket.emit('app:error', { message: err.message || 'Failed to close conversation' });
    }
  });

  // agent:suggest -> requests AI suggested reply with knowledge base RAG
  socket.on('agent:suggest', async (data = {}) => {
    try {
      const { conversationId } = data;
      const conversation = await verifyAgentConversation(conversationId, workspaceId);
      if (!conversation) {
        socket.emit('app:error', { message: 'Conversation not found or access denied' });
        return;
      }

      // Check per-agent cooldown
      const cooldownCheck = checkAgentAiCooldown(user._id.toString());
      if (!cooldownCheck.allowed) {
        socket.emit('ai:error', {
          message: `AI cooldown active. Please wait ${cooldownCheck.remainingSeconds}s.`
        });
        return;
      }

      // Load last 10 messages for context
      const allMessages = await Message.find({ conversation: conversationId }).sort({ createdAt: 1 });
      const recentMessages = allMessages.slice(-10);

      const customerMsgs = recentMessages.filter(m => m.senderType === 'customer');
      const queryText = customerMsgs.length > 0 ? customerMsgs[customerMsgs.length - 1].text : '';
      // Real AI keeps $text retrieval; mock mode loads workspace articles for keyword matching
      const articles = env.GEMINI_API_KEY
        ? await findRelevantArticles(workspaceId, queryText, 3)
        : await Article.find({ workspace: workspaceId });

      // Generate suggested reply
      const suggestion = await suggestReply({
        conversation,
        messages: recentMessages,
        articles
      });

      // Update sentiment and urgency on the conversation
      conversation.sentiment = suggestion.sentiment;
      conversation.urgency = suggestion.urgency;
      await conversation.save();

      // Reply ONLY to requesting agent socket
      socket.emit('ai:suggestion', {
        conversationId,
        reply: suggestion.reply,
        sentiment: suggestion.sentiment,
        urgency: suggestion.urgency,
        sources: suggestion.sources,
        provider: suggestion.provider
      });

      // Broadcast updated metadata to workspace
      const populated = await Conversation.findById(conversationId).populate('assignee', 'username email');
      const wsRoom = `ws:${workspaceId}`;
      io.to(wsRoom).emit('conversation:updated', populated);
    } catch (err) {
      console.error('[Agent Socket Error: agent:suggest]', err.message);
      socket.emit('ai:error', { message: mapAiErrorToMessage(err) });
    }
  });
}
