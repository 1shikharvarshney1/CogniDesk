import { Article } from '../models/Article.js';
import { env } from '../config/env.js';
import { generateEmbedding, cosineSimilarity } from './embeddingService.js';

/**
 * Finds relevant articles using MongoDB $text search.
 * Strictly scoped to the specified workspaceId.
 */
export async function findTextArticles(workspaceId, text, limit = 3) {
  if (!text || !text.trim()) return [];

  try {
    const articles = await Article.find(
      {
        workspace: workspaceId,
        $text: { $search: text }
      },
      {
        score: { $meta: 'textScore' }
      }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit);

    return articles;
  } catch (err) {
    console.warn('[Retrieval] Text search note:', err.message);
    return [];
  }
}

/**
 * Finds relevant articles using dense vector embeddings and in-memory cosine similarity.
 * Strictly scoped to the specified workspaceId.
 * Falls back to text search if API key is missing or embedding generation fails.
 */
export async function findVectorArticles(workspaceId, text, limit = 3, options = {}) {
  if (!text || !text.trim()) return [];

  // Use pre-computed query embedding if passed (e.g. from eval timer), or generate fresh
  let queryValues = options.queryEmbedding || null;

  if (!queryValues) {
    try {
      const queryEmbedRes = await generateEmbedding(text, { taskType: 'RETRIEVAL_QUERY' });
      queryValues = queryEmbedRes?.values || null;
    } catch (err) {
      console.warn('[Retrieval] Vector query embedding error, falling back to text search:', err.message);
    }
  }

  // Fallback to text search if query embedding could not be generated
  if (!queryValues) {
    console.warn('[Retrieval] Query embedding unavailable, falling back to text search');
    return findTextArticles(workspaceId, text, limit);
  }

  try {
    // 1. Fetch workspace-scoped articles that have an embedding
    // MUST use .select('+embedding') because embedding has select: false
    const articles = await Article.find({
      workspace: workspaceId,
      embedding: { $exists: true, $ne: [] }
    }).select('+embedding title content workspace embeddingModel');

    if (articles.length === 0) {
      console.warn('[Retrieval] No embedded articles found in workspace, falling back to text search');
      return findTextArticles(workspaceId, text, limit);
    }

    // 2. Compute cosine similarity for each candidate
    const scored = articles.map((art) => ({
      article: art,
      similarity: cosineSimilarity(queryValues, art.embedding)
    }));

    // 3. Sort by similarity descending
    scored.sort((a, b) => b.similarity - a.similarity);

    // 4. Return top articles
    return scored.slice(0, limit).map((s) => s.article);
  } catch (err) {
    console.warn('[Retrieval] Vector search failed, falling back to text search:', err.message);
    return findTextArticles(workspaceId, text, limit);
  }
}

/**
 * Hybrid search combining $text search and vector search using Reciprocal Rank Fusion (RRF, k=60).
 * Strictly scoped to the specified workspaceId.
 */
export async function findHybridArticles(workspaceId, text, limit = 3, options = {}) {
  if (!text || !text.trim()) return [];

  const candidateLimit = Math.max(limit * 3, 10);
  const RRF_K = 60; // Standard reciprocal rank fusion parameter

  try {
    // Run text search and vector search in parallel
    const [textArticles, vectorArticles] = await Promise.all([
      findTextArticles(workspaceId, text, candidateLimit),
      findVectorArticles(workspaceId, text, candidateLimit, options)
    ]);

    // If one mode failed completely or returned nothing, return the other
    if (textArticles.length === 0) return vectorArticles.slice(0, limit);
    if (vectorArticles.length === 0) return textArticles.slice(0, limit);

    const rrfScores = new Map(); // idStr -> { article, score }

    // Score text rankings: 1 / (k + rank)
    textArticles.forEach((art, idx) => {
      const id = art._id.toString();
      const rank = idx + 1;
      const score = 1 / (RRF_K + rank);
      rrfScores.set(id, { article: art, score });
    });

    // Score vector rankings and add to existing RRF score
    vectorArticles.forEach((art, idx) => {
      const id = art._id.toString();
      const rank = idx + 1;
      const score = 1 / (RRF_K + rank);
      if (rrfScores.has(id)) {
        rrfScores.get(id).score += score;
      } else {
        rrfScores.set(id, { article: art, score });
      }
    });

    // Sort by merged RRF score descending
    const merged = Array.from(rrfScores.values()).sort((a, b) => b.score - a.score);

    return merged.slice(0, limit).map((item) => item.article);
  } catch (err) {
    console.warn('[Retrieval] Hybrid search error, falling back to text search:', err.message);
    return findTextArticles(workspaceId, text, limit);
  }
}

/**
 * Main unified retrieval function.
 * Respects env.RETRIEVAL_MODE ('text' | 'vector' | 'hybrid') or options.mode override.
 * Preserves exact input and output shape for seamless integration.
 *
 * @param {string|ObjectId} workspaceId
 * @param {string} text
 * @param {number} [limit=3]
 * @param {object} [options={}]
 * @param {'text'|'vector'|'hybrid'} [options.mode]
 * @param {number[]} [options.queryEmbedding]
 * @returns {Promise<Array>}
 */
export async function findRelevantArticles(workspaceId, text, limit = 3, options = {}) {
  const mode = (options.mode || env.RETRIEVAL_MODE || 'text').toLowerCase();

  switch (mode) {
    case 'vector':
      return findVectorArticles(workspaceId, text, limit, options);
    case 'hybrid':
      return findHybridArticles(workspaceId, text, limit, options);
    case 'text':
    default:
      return findTextArticles(workspaceId, text, limit);
  }
}
