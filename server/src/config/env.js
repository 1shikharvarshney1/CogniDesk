import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load server/.env from this file's location (cwd-independent)
const serverEnvPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else {
  dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
}

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable is required in production.');
}

export const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/supportdesk',
  JWT_SECRET: process.env.JWT_SECRET || 'dev_insecure_secret_set_in_env_file',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  GEMINI_API_KEY: (process.env.GEMINI_API_KEY || '').trim(),
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash',
  AI_COOLDOWN_SECONDS: parseInt(process.env.AI_COOLDOWN_SECONDS || '5', 10),
  RETRIEVAL_MODE: ['text', 'vector', 'hybrid'].includes((process.env.RETRIEVAL_MODE || '').toLowerCase())
    ? process.env.RETRIEVAL_MODE.toLowerCase()
    : 'text',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'gemini-embedding-001'
};

// Safe key logging: only set/not set and length, never value
const keyStatus = env.GEMINI_API_KEY
  ? `set (length: ${env.GEMINI_API_KEY.length})`
  : 'not set';
console.log(`[Config] GEMINI_API_KEY is ${keyStatus}`);
console.log(`[Config] RETRIEVAL_MODE is ${env.RETRIEVAL_MODE} | EMBEDDING_MODEL is ${env.EMBEDDING_MODEL}`);

