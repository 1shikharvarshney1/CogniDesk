import { z } from 'zod';
import { Article } from '../models/Article.js';
import { AppError } from '../utils/errors.js';
import { generateEmbedding } from '../services/embeddingService.js';

const articleSchema = z.object({
  title: z.string().min(1, 'Title is required').trim(),
  content: z.string().min(1, 'Content is required').max(4000, 'Content cannot exceed 4000 characters').trim()
});

export async function getArticles(req, res, next) {
  try {
    if (!req.user.workspace) {
      return res.json([]);
    }

    const workspaceId = req.user.workspace._id || req.user.workspace;
    const articles = await Article.find({ workspace: workspaceId }).sort({ createdAt: -1 });
    return res.json(articles);
  } catch (err) {
    next(err);
  }
}

export async function createArticle(req, res, next) {
  try {
    if (!req.user.workspace) {
      throw new AppError('No workspace associated with your account', 400);
    }

    const { title, content } = articleSchema.parse(req.body);
    const workspaceId = req.user.workspace._id || req.user.workspace;

    // Optional vector embedding generation
    let embedding;
    let embeddingModel;
    let embeddingDimension;
    try {
      const embedRes = await generateEmbedding(`${title}\n\n${content}`, {
        taskType: 'RETRIEVAL_DOCUMENT',
        title
      });
      if (embedRes?.values) {
        embedding = embedRes.values;
        embeddingModel = embedRes.model;
        embeddingDimension = embedRes.dimension || embedRes.values.length;
      }
    } catch (embedErr) {
      console.warn('[Article] Non-fatal: embedding generation failed on create:', embedErr.message);
    }

    const article = await Article.create({
      workspace: workspaceId,
      title,
      content,
      ...(embedding ? { embedding, embeddingModel, embeddingDimension } : {})
    });

    return res.status(201).json(article);
  } catch (err) {
    next(err);
  }
}

export async function updateArticle(req, res, next) {
  try {
    if (!req.user.workspace) {
      throw new AppError('No workspace associated with your account', 400);
    }

    const { id } = req.params;
    const { title, content } = articleSchema.parse(req.body);
    const workspaceId = (req.user.workspace._id || req.user.workspace).toString();

    const article = await Article.findById(id);
    if (!article) {
      throw new AppError('Article not found', 404);
    }

    if (article.workspace.toString() !== workspaceId) {
      throw new AppError('Forbidden: Access denied to article in another workspace', 403);
    }

    article.title = title;
    article.content = content;

    try {
      const embedRes = await generateEmbedding(`${title}\n\n${content}`, {
        taskType: 'RETRIEVAL_DOCUMENT',
        title
      });
      if (embedRes?.values) {
        article.embedding = embedRes.values;
        article.embeddingModel = embedRes.model;
        article.embeddingDimension = embedRes.dimension || embedRes.values.length;
      }
    } catch (embedErr) {
      console.warn('[Article] Non-fatal: embedding generation failed on update:', embedErr.message);
    }

    await article.save();

    return res.json(article);
  } catch (err) {
    next(err);
  }
}

export async function deleteArticle(req, res, next) {
  try {
    if (!req.user.workspace) {
      throw new AppError('No workspace associated with your account', 400);
    }

    const { id } = req.params;
    const workspaceId = (req.user.workspace._id || req.user.workspace).toString();

    const article = await Article.findById(id);
    if (!article) {
      throw new AppError('Article not found', 404);
    }

    if (article.workspace.toString() !== workspaceId) {
      throw new AppError('Forbidden: Access denied to article in another workspace', 403);
    }

    await Article.deleteOne({ _id: id });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
