import { Article } from '../models/Article.js';

/**
 * Finds relevant knowledge base articles for a workspace using MongoDB $text search.
 * Scoped strictly to the provided workspaceId and sorted by text relevance score.
 *
 * @param {string|ObjectId} workspaceId
 * @param {string} text
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function findRelevantArticles(workspaceId, text, limit = 3) {
  if (!text || !text.trim()) {
    return [];
  }

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
    // Return empty list if text search fails (e.g. stop words only or index building)
    console.warn('[Retrieval] Text search note:', err.message);
    return [];
  }
}
