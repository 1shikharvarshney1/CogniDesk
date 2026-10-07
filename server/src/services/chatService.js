import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { generateVisitorId } from '../utils/keys.js';
import { AppError } from '../utils/errors.js';

/**
 * Resumes an existing open conversation or creates a new one for a guest customer.
 */
export async function startOrResumeCustomerConversation({
  workspaceId,
  visitorId,
  customerName,
  customerEmail = ''
}) {
  const activeVisitorId = visitorId || generateVisitorId();
  const trimmedName = (customerName || '').trim();

  // Look for an existing open conversation for this visitor in this workspace
  let conversation = await Conversation.findOne({
    workspace: workspaceId,
    visitorId: activeVisitorId,
    status: 'open'
  });

  let isNew = false;
  if (!conversation) {
    conversation = await Conversation.create({
      workspace: workspaceId,
      visitorId: activeVisitorId,
      customerName: trimmedName || 'Guest',
      customerEmail: (customerEmail || '').trim(),
      status: 'open',
      lastMessageAt: new Date(),
      lastMessageText: '',
      unreadForAgents: 0
    });
    isNew = true;
  } else if (trimmedName && trimmedName !== conversation.customerName) {
    conversation.customerName = trimmedName;
    if (customerEmail) conversation.customerEmail = customerEmail.trim();
    await conversation.save();
  }

  // Fetch full message history for the conversation
  const messages = await Message.find({ conversation: conversation._id }).sort({ createdAt: 1 });

  return { conversation, messages, isNew, visitorId: activeVisitorId };
}

/**
 * Saves a message from a customer or agent and updates conversation state.
 */
export async function saveMessage({ conversationId, senderType, senderName, text, agentId = null }) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    throw new AppError('Message text cannot be empty', 400);
  }
  if (trimmed.length > 1000) {
    throw new AppError('Message text cannot exceed 1000 characters', 400);
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw new AppError('Conversation not found', 404);
  }
  if (conversation.status === 'closed') {
    throw new AppError('Cannot send message to a closed conversation', 400);
  }

  const resolvedSenderName = senderType === 'customer'
    ? (conversation.customerName || senderName || 'Customer')
    : (senderName || 'Agent');

  const message = await Message.create({
    conversation: conversation._id,
    senderType,
    senderName: resolvedSenderName,
    text: trimmed
  });

  const now = new Date();
  conversation.lastMessageAt = now;
  conversation.lastMessageText = trimmed;

  if (senderType === 'customer') {
    conversation.unreadForAgents += 1;
  } else if (senderType === 'agent') {
    // If this is the first agent reply, calculate firstResponseMs
    // (measured from the first customer message to the first agent reply)
    if (conversation.firstResponseMs == null) {
      const firstCustomerMsg = await Message.findOne({
        conversation: conversation._id,
        senderType: 'customer'
      }).sort({ createdAt: 1 });

      const startTime = firstCustomerMsg
        ? new Date(firstCustomerMsg.createdAt).getTime()
        : new Date(conversation.createdAt).getTime();

      conversation.firstResponseMs = Math.max(1, now.getTime() - startTime);
    }
    // Auto-assign to this agent if unassigned
    if (!conversation.assignee && agentId) {
      conversation.assignee = agentId;
    }
  }

  await conversation.save();
  return { message, conversation };
}

/**
 * Marks messages in a conversation as read and resets unread count.
 */
export async function markConversationAsRead(conversationId) {
  const now = new Date();
  await Message.updateMany(
    { conversation: conversationId, readAt: null },
    { $set: { readAt: now } }
  );

  const conversation = await Conversation.findByIdAndUpdate(
    conversationId,
    { $set: { unreadForAgents: 0 } },
    { new: true }
  ).populate('assignee', 'username email');

  return conversation;
}

/**
 * Calculates live stats for an agent's workspace: open, unassigned, avgFirstResponseMs
 */
export async function getWorkspaceStats(workspaceId) {
  const wsObjectId = new mongoose.Types.ObjectId(workspaceId);

  const [openCount, unassignedCount, avgResult] = await Promise.all([
    Conversation.countDocuments({ workspace: wsObjectId, status: 'open' }),
    Conversation.countDocuments({ workspace: wsObjectId, status: 'open', assignee: null }),
    Conversation.aggregate([
      {
        $match: {
          workspace: wsObjectId,
          firstResponseMs: { $ne: null, $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          avgResponseMs: { $avg: '$firstResponseMs' }
        }
      }
    ])
  ]);

  const avgFirstResponseMs = avgResult.length > 0 && avgResult[0].avgResponseMs !== null
    ? Math.round(avgResult[0].avgResponseMs)
    : 0;

  return {
    open: openCount,
    unassigned: unassignedCount,
    avgFirstResponseMs
  };
}
