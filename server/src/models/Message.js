import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    senderType: {
      type: String,
      enum: ['customer', 'agent'],
      required: true
    },
    senderName: {
      type: String,
      required: true,
      trim: true
    },
    text: {
      type: String,
      required: true,
      maxlength: 1000
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

export const Message = mongoose.model('Message', messageSchema);
