import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

let aiClient = null;

// Lazily initializes the GoogleGenAI client only when an API key is provided
function getAiClient() {
  if (!env.GEMINI_API_KEY || !env.GEMINI_API_KEY.trim()) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY.trim() });
  }
  return aiClient;
}

// Strips markdown code block fences if present in model output
function cleanJsonText(rawText) {
  if (!rawText) return '';
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

/**
 * Calls Gemini with structured JSON output and fallback model on 429/503/404.
 * Returns parsed JSON object or null if no API key is configured.
 */
export async function generateJson({ systemInstruction, userPrompt }) {
  const client = getAiClient();
  if (!client) {
    // Mock mode / no API key configured
    return null;
  }

  const callModel = async (modelName) => {
    // 30-second timeout promise
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const timeoutErr = new Error('AI request timed out after 30 seconds');
        timeoutErr.status = 408;
        reject(timeoutErr);
      }, 30000);
    });

    try {
      const responsePromise = client.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          temperature: 0.4,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json'
        }
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);
      clearTimeout(timer);

      const raw = response.text;
      if (!raw || !raw.trim()) {
        const err = new Error('Empty response from AI model');
        err.status = 500;
        throw err;
      }

      const cleaned = cleanJsonText(raw);
      return JSON.parse(cleaned);
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  try {
    return await callModel(env.GEMINI_MODEL);
  } catch (err) {
    const status = err.status || err.statusCode || err.response?.status;
    const isRecoverable = status === 429 || status === 503 || status === 404 ||
      /429|503|404|resource_exhausted|unavailable|not found/i.test(err.message || '');

    if (isRecoverable && env.GEMINI_FALLBACK_MODEL && env.GEMINI_FALLBACK_MODEL !== env.GEMINI_MODEL) {
      console.warn(`[LLM] Primary model failed (${status || err.message}). Retrying with fallback model: ${env.GEMINI_FALLBACK_MODEL}`);
      try {
        return await callModel(env.GEMINI_FALLBACK_MODEL);
      } catch (fallbackErr) {
        console.error('[LLM] Fallback model also failed:', fallbackErr.message);
        throw fallbackErr;
      }
    }

    console.error('[LLM] Primary model call failed:', err.message);
    throw err;
  }
}
