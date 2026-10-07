import mongoose from 'mongoose';

const articleSchema = new mongoose.Schema(
  {
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    content: {
      type: String,
      required: true,
      maxlength: 4000
    }
  },
  { timestamps: true }
);

// MongoDB full-text index on title and content for RAG search
articleSchema.index({ title: 'text', content: 'text' });

export const Article = mongoose.model('Article', articleSchema);
