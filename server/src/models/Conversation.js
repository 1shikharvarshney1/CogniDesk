import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    visitorId: {
      type: String,
      required: true,
      index: true
    },
    customerName: {
      type: String,
      required: true,
      trim: true
    },
    customerEmail: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
      index: true
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    sentiment: {
      type: String,
      enum: ['calm', 'frustrated', 'angry'],
      default: 'calm'
    },
    urgency: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    summary: {
      type: String,
      default: ''
    },
    firstResponseMs: {
      type: Number,
      default: null
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    lastMessageText: {
      type: String,
      default: ''
    },
    unreadForAgents: {
      type: Number,
      default: 0
    },
    closedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

export const Conversation = mongoose.model('Conversation', conversationSchema);
