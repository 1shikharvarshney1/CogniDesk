import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

let aiClient = null;

function getAiClient() {
  if (!env.GEMINI_API_KEY || !env.GEMINI_API_KEY.trim()) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY.trim() });
  }
  return aiClient;
}

/**
 * Normalizes a vector to unit length (L2 norm).
 * Required when outputDimensionality is adjusted or for stable dot products.
 */
export function normalizeVector(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return vec;
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Computes cosine similarity between two numeric vectors of arbitrary dimension.
 * Returns value between -1.0 and 1.0 (or 0 if invalid).
 */
export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * Generates dense vector embedding using Gemini embedding model.
 * Respects taskType (RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY).
 *
 * @param {string} text
 * @param {object} options
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} [options.taskType='RETRIEVAL_DOCUMENT']
 * @param {string} [options.title='']
 * @returns {Promise<{ values: number[], model: string }|null>}
 */
export async function generateEmbedding(text, { taskType = 'RETRIEVAL_DOCUMENT', title = '' } = {}) {
  const client = getAiClient();
  if (!client || !text || !text.trim()) {
    return null;
  }

  const model = env.EMBEDDING_MODEL || 'gemini-embedding-001';

  try {
    const config = { taskType };
    if (title && title.trim()) {
      config.title = title.trim();
    }

    const res = await client.models.embedContent({
      model,
      contents: text.trim(),
      config
    });

    const rawValues = res.embeddings?.[0]?.values || res.embedding?.values || null;
    if (!rawValues || !Array.isArray(rawValues) || rawValues.length === 0) {
      console.warn(`[Embedding] Empty embedding values returned from model ${model}`);
      return null;
    }

    // Return normalized vector for fast cosine similarity / dot product calculation
    const values = normalizeVector(rawValues);
    return { values, model };
  } catch (err) {
    console.warn(`[Embedding] Warning: Failed to generate embedding with ${model}:`, err.message);
    return null;
  }
}
