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
 * Calls local Python embedding microservice over HTTP.
 * Returns { values, model, dimension } or null on failure.
 */
async function generateLocalEmbedding(text) {
  if (!text || !text.trim()) return null;

  const url = `${env.EMBEDDING_SERVICE_URL}/embed`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [text.trim()] }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[Embedding] Local embedding service returned HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const values = data.embeddings?.[0] || null;
    if (!values || !Array.isArray(values) || values.length === 0) {
      console.warn('[Embedding] Local embedding service returned empty vector');
      return null;
    }

    // Vectors from sentence-transformers with normalize_embeddings=True are already L2 normalized
    return {
      values,
      model: data.model || env.EMBEDDING_MODEL || 'all-MiniLM-L6-v2',
      dimension: data.dimension || values.length
    };
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[Embedding] Local embedding service request failed:', err.message);
    return null;
  }
}

/**
 * Generates embedding using Gemini embedding model.
 */
async function generateGeminiEmbedding(text, { taskType = 'RETRIEVAL_DOCUMENT', title = '', model: customModel = '' } = {}) {
  const client = getAiClient();
  if (!client || !text || !text.trim()) {
    return null;
  }

  const model = customModel || (env.EMBEDDING_PROVIDER === 'gemini' ? env.EMBEDDING_MODEL : 'gemini-embedding-001');

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

    const values = normalizeVector(rawValues);
    return { values, model, dimension: values.length };
  } catch (err) {
    console.warn(`[Embedding] Warning: Failed to generate embedding with ${model}:`, err.message);
    return null;
  }
}

/**
 * Unified embedding generator routing to configured provider (local vs gemini).
 *
 * @param {string} text
 * @param {object} [options]
 * @param {'local'|'gemini'} [options.provider]
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} [options.taskType='RETRIEVAL_DOCUMENT']
 * @param {string} [options.title='']
 * @returns {Promise<{ values: number[], model: string, dimension: number }|null>}
 */
export async function generateEmbedding(text, options = {}) {
  const provider = (options.provider || env.EMBEDDING_PROVIDER || 'local').toLowerCase();

  if (provider === 'gemini') {
    return generateGeminiEmbedding(text, options);
  }

  return generateLocalEmbedding(text);
}

/**
 * Batch embedding generator for multiple texts.
 *
 * @param {string[]} texts
 * @param {object} [options]
 * @returns {Promise<Array<{ values: number[], model: string, dimension: number }|null>>}
 */
export async function generateBatchEmbeddings(texts, options = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const provider = (options.provider || env.EMBEDDING_PROVIDER || 'local').toLowerCase();

  if (provider === 'local') {
    const url = `${env.EMBEDDING_SERVICE_URL}/embed`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: texts.map((t) => (t || '').trim()) }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        console.warn(`[Embedding] Local batch embedding service returned HTTP ${res.status}`);
        return texts.map(() => null);
      }

      const data = await res.json();
      return (data.embeddings || []).map((vec) => ({
        values: vec,
        model: data.model || env.EMBEDDING_MODEL || 'all-MiniLM-L6-v2',
        dimension: data.dimension || vec.length
      }));
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('[Embedding] Local batch embedding failed:', err.message);
      return texts.map(() => null);
    }
  }

  // Gemini sequential/parallel fallback
  const results = [];
  for (const t of texts) {
    results.push(await generateGeminiEmbedding(t, options));
  }
  return results;
}
