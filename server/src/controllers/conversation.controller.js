import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { getWorkspaceStats } from '../services/chatService.js';
import { AppError } from '../utils/errors.js';

export async function getConversations(req, res, next) {
  try {
    if (!req.user.workspace) {
      return res.json([]);
    }

    const workspaceId = req.user.workspace._id || req.user.workspace;
    const filter = { workspace: workspaceId };

    if (req.query.status && ['open', 'closed'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const conversations = await Conversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .populate('assignee', 'username email');

    return res.json(conversations);
  } catch (err) {
    next(err);
  }
}

export async function getConversationMessages(req, res, next) {
  try {
    if (!req.user.workspace) {
      throw new AppError('No workspace associated with your account', 400);
    }

    const { id } = req.params;
    const conversation = await Conversation.findById(id);

    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    const workspaceId = (req.user.workspace._id || req.user.workspace).toString();
    if (conversation.workspace.toString() !== workspaceId) {
      throw new AppError('Forbidden: Access denied to conversation in another workspace', 403);
    }

    const messages = await Message.find({ conversation: id }).sort({ createdAt: 1 });
    return res.json(messages);
  } catch (err) {
    next(err);
  }
}

export async function getStats(req, res, next) {
  try {
    if (!req.user.workspace) {
      return res.json({ open: 0, unassigned: 0, avgFirstResponseMs: 0 });
    }

    const workspaceId = req.user.workspace._id || req.user.workspace;
    const stats = await getWorkspaceStats(workspaceId);
    return res.json(stats);
  } catch (err) {
    next(err);
  }
}
