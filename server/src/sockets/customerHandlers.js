import { Conversation } from '../models/Conversation.js';
import {
  startOrResumeCustomerConversation,
  saveMessage,
  getWorkspaceStats
} from '../services/chatService.js';
import { checkCustomerMessageRate } from '../services/rateLimiter.js';

export function registerCustomerHandlers(io, socket) {
  // customer:start -> joins room, returns conversation details
  socket.on('customer:start', async (data = {}) => {
    try {
      const { name, email } = data;
      const workspace = socket.data.workspace;
      const visitorId = socket.data.visitorId || data.visitorId;

      const { conversation, messages, isNew, visitorId: finalVisitorId } =
        await startOrResumeCustomerConversation({
          workspaceId: workspace._id,
          visitorId,
          customerName: name,
          customerEmail: email
        });

      // Bind socket to conversation session
      socket.data.conversationId = conversation._id.toString();
      socket.data.visitorId = finalVisitorId;

      const convRoom = `conv:${conversation._id}`;
      socket.join(convRoom);

      // Reply directly to customer
      socket.emit('customer:ready', {
        conversationId: conversation._id.toString(),
        visitorId: finalVisitorId,
        customerName: conversation.customerName,
        workspaceName: workspace.name,
        messages
      });

      const wsRoom = `ws:${workspace._id}`;

      // Notify agents with new or updated conversation
      const populatedConv = await Conversation.findById(conversation._id).populate('assignee', 'username email');
      if (isNew) {
        io.to(wsRoom).emit('conversation:new', populatedConv);
      } else {
        io.to(wsRoom).emit('conversation:updated', populatedConv);
      }
      const stats = await getWorkspaceStats(workspace._id);
      io.to(wsRoom).emit('stats:update', stats);

      // Notify agents of customer online presence
      io.to(wsRoom).emit('customer:presence', {
        conversationId: conversation._id.toString(),
        online: true
      });
    } catch (err) {
      console.error('[Customer Socket Error: customer:start]', err.message);
      socket.emit('app:error', { message: err.message || 'Failed to start chat session' });
    }
  });

  // customer:message -> sends message, updates unread and stats
  socket.on('customer:message', async (data = {}) => {
    try {
      const { text } = data;
      const conversationId = socket.data.conversationId;
      const visitorId = socket.data.visitorId;
      const workspaceId = socket.data.workspaceId;

      if (!conversationId) {
        socket.emit('app:error', { message: 'Chat session has not been started yet' });
        return;
      }

      // Customer rate limit check (max 20 / minute)
      if (!checkCustomerMessageRate(visitorId, 20)) {
        socket.emit('app:error', { message: 'Rate limit exceeded: Please wait before sending more messages.' });
        return;
      }

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        socket.emit('app:error', { message: 'Conversation not found' });
        return;
      }

      // Verify conversation ownership
      if (conversation.visitorId !== visitorId) {
        socket.emit('app:error', { message: 'Unauthorized conversation access' });
        return;
      }

      // Reject writes to closed conversation
      if (conversation.status === 'closed') {
        socket.emit('conversation:closed', { conversationId });
        socket.emit('app:error', { message: 'This conversation has been closed.' });
        return;
      }

      const { message, conversation: updatedConv } = await saveMessage({
        conversationId,
        senderType: 'customer',
        senderName: conversation.customerName || 'Customer',
        text
      });

      const convRoom = `conv:${conversationId}`;
      const wsRoom = `ws:${workspaceId}`;

      // Emit new message to conversation room and workspace room
      io.to(convRoom).to(wsRoom).emit('message:new', message);

      // Emit conversation update and live stats to agents
      const populated = await Conversation.findById(conversationId).populate('assignee', 'username email');
      io.to(wsRoom).emit('conversation:updated', populated);

      const stats = await getWorkspaceStats(workspaceId);
      io.to(wsRoom).emit('stats:update', stats);
    } catch (err) {
      console.error('[Customer Socket Error: customer:message]', err.message);
      socket.emit('app:error', { message: err.message || 'Failed to send message' });
    }
  });

  // customer:typing -> relays typing indicator
  socket.on('customer:typing', (data = {}) => {
    try {
      const conversationId = socket.data.conversationId;
      if (!conversationId) return;

      const convRoom = `conv:${conversationId}`;
      socket.to(convRoom).emit('typing', {
        from: 'customer',
        typing: Boolean(data.typing)
      });
    } catch (err) {
      console.error('[Customer Socket Error: customer:typing]', err.message);
    }
  });

  // customer disconnect -> presence offline
  socket.on('disconnect', () => {
    try {
      const conversationId = socket.data.conversationId;
      const workspaceId = socket.data.workspaceId;
      if (conversationId && workspaceId) {
        const wsRoom = `ws:${workspaceId}`;
        io.to(wsRoom).emit('customer:presence', {
          conversationId,
          online: false
        });
      }
    } catch (err) {
      console.error('[Customer Socket Error: disconnect]', err.message);
    }
  });
}
