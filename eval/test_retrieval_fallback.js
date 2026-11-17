import mongoose from '../server/node_modules/mongoose/index.js';
import { env } from '../server/src/config/env.js';
import { Workspace } from '../server/src/models/Workspace.js';
import { Article } from '../server/src/models/Article.js';
import { findRelevantArticles, findVectorArticles, findHybridArticles } from '../server/src/services/retrievalService.js';

async function runFallbackTests() {
  console.log('=== Step 1 Verification: Retrieval Service Down / Error Fallback Test ===');
  await mongoose.connect(env.MONGODB_URI);

  // 1. Create test workspace and article
  const testWs = await Workspace.create({
    name: 'Retrieval Fallback Test Workspace',
    publicKey: `pk_fallback_test_${Date.now()}`,
    joinCode: 'FLLBCK',
    owner: new mongoose.Types.ObjectId()
  });

  const testArt = await Article.create({
    workspace: testWs._id,
    title: 'Password Reset Procedures',
    content: 'Click forgot password on the login screen to receive a secure password reset link.'
  });

  await Article.syncIndexes();

  const results = [];

  // Test Case 1: Point embedding service URL to non-existent port (service down)
  const originalUrl = env.EMBEDDING_SERVICE_URL;
  env.EMBEDDING_SERVICE_URL = 'http://127.0.0.1:59999'; // Dead port

  try {
    console.log('Testing vector retrieval with dead embedding service URL (http://127.0.0.1:59999)...');
    const articles = await findRelevantArticles(testWs._id, 'password reset', 3, { mode: 'vector' });
    const success = articles.length > 0 && articles[0]._id.toString() === testArt._id.toString();
    results.push({
      test: 'Vector retrieval falls back to $text search when embedding service is unreachable',
      passed: success,
      details: success ? `Successfully fell back to text search; returned "${articles[0].title}"` : 'Failed to retrieve article via fallback'
    });
  } catch (err) {
    results.push({
      test: 'Vector retrieval falls back to $text search when embedding service is unreachable',
      passed: false,
      details: `Threw error instead of falling back: ${err.message}`
    });
  }

  // Test Case 2: Hybrid retrieval with dead embedding service
  try {
    console.log('Testing hybrid retrieval with dead embedding service URL...');
    const articles = await findRelevantArticles(testWs._id, 'password reset', 3, { mode: 'hybrid' });
    const success = articles.length > 0 && articles[0]._id.toString() === testArt._id.toString();
    results.push({
      test: 'Hybrid retrieval falls back to $text search when embedding service is unreachable',
      passed: success,
      details: success ? `Successfully fell back to text search; returned "${articles[0].title}"` : 'Failed to retrieve article via fallback'
    });
  } catch (err) {
    results.push({
      test: 'Hybrid retrieval falls back to $text search when embedding service is unreachable',
      passed: false,
      details: `Threw error instead of falling back: ${err.message}`
    });
  }

  // Restore URL
  env.EMBEDDING_SERVICE_URL = originalUrl;

  // Clean up
  await Article.deleteMany({ workspace: testWs._id });
  await Workspace.deleteMany({ _id: testWs._id });
  await mongoose.disconnect();

  console.log('\n=== Fallback Test Results ===');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '[PASS]' : '[FAIL]';
    console.log(`${mark} ${r.test} -> ${r.details}`);
    if (!r.passed) allPassed = false;
  }

  if (!allPassed) {
    console.error('Some fallback tests failed.');
    process.exit(1);
  } else {
    console.log('All retrieval fallback tests passed successfully.');
  }
}

runFallbackTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
