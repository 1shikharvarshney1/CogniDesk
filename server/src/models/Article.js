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
    },
    // Optional dense vector embedding for semantic search (e.g. gemini-embedding-001)
    // select: false ensures normal queries don't transfer raw vector floats
    embedding: {
      type: [Number],
      default: undefined,
      select: false
    },
    embeddingModel: {
      type: String,
      default: undefined
    },
    embeddingDimension: {
      type: Number,
      default: undefined
    }
  },
  { timestamps: true }
);

// MongoDB full-text index on title and content for RAG search
articleSchema.index({ title: 'text', content: 'text' });

export const Article = mongoose.model('Article', articleSchema);
