import mongoose from 'mongoose';
import { Article } from '../models/Article.js';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { generateEmbedding } from '../services/embeddingService.js';

async function backfill() {
  console.log('=== CogniDesk Article Embedding Backfill Script ===');
  console.log(`Provider: ${env.EMBEDDING_PROVIDER} | Target Model: ${env.EMBEDDING_MODEL}`);

  if (env.EMBEDDING_PROVIDER === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      console.error('ERROR: GEMINI_API_KEY is not set. Cannot generate Gemini embeddings in mock mode.');
      process.exit(1);
    }
  } else {
    // Verify local embedding microservice is running
    try {
      const res = await fetch(`${env.EMBEDDING_SERVICE_URL}/health`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const health = await res.json();
      console.log(`Local embedding service healthy (model: ${health.model}, dim: ${health.dimension})`);
    } catch (err) {
      console.error(`ERROR: Local embedding microservice unreachable at ${env.EMBEDDING_SERVICE_URL}: ${err.message}`);
      console.error('Please start the embedding service before running backfill:');
      console.error('  python embedding-service/main.py');
      process.exit(1);
    }
  }

  await connectDB();

  // Find all articles missing embeddings or generated with a different model
  const query = {
    $or: [
      { embedding: { $exists: false } },
      { embedding: null },
      { embedding: { $size: 0 } },
      { embeddingModel: { $ne: env.EMBEDDING_MODEL } }
    ]
  };

  const articles = await Article.find(query).select('+embedding');
  console.log(`Found ${articles.length} articles requiring embeddings.`);

  if (articles.length === 0) {
    console.log('All articles already have up-to-date embeddings. Done.');
    await mongoose.disconnect();
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    const textToEmbed = `${art.title}\n\n${art.content}`;

    console.log(`[${i + 1}/${articles.length}] Generating embedding for: "${art.title}" (${art._id})...`);
    const embedRes = await generateEmbedding(textToEmbed, {
      taskType: 'RETRIEVAL_DOCUMENT',
      title: art.title
    });

    if (embedRes?.values) {
      art.embedding = embedRes.values;
      art.embeddingModel = embedRes.model;
      art.embeddingDimension = embedRes.dimension || embedRes.values.length;
      await art.save();
      successCount++;
      console.log(`  -> Saved embedding (dim: ${art.embeddingDimension}, model: ${embedRes.model})`);
    } else {
      failCount++;
      console.warn(`  -> Failed to generate embedding for "${art.title}"`);
    }

    // Rate-limit safety pacing between requests
    if (i < articles.length - 1) {
      const paceMs = env.EMBEDDING_PROVIDER === 'local' ? 50 : 400;
      await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
  }

  console.log('\n=== Backfill Summary ===');
  console.log(`Total Articles Processed: ${articles.length}`);
  console.log(`Successfully Embedded   : ${successCount}`);
  console.log(`Failed                  : ${failCount}`);

  await mongoose.disconnect();
  console.log('Disconnected from database.');
}

backfill().catch((err) => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
