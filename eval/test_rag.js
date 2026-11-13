import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import mongoose from '../server/node_modules/mongoose/index.js';

import { env } from '../server/src/config/env.js';
import { Article } from '../server/src/models/Article.js';
import { Workspace } from '../server/src/models/Workspace.js';
import { findRelevantArticles } from '../server/src/services/retrievalService.js';
import { suggestReply } from '../server/src/services/aiAssist.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function computePercentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

async function runRagEvaluation() {
  console.log('=== Step 5: RAG Evaluation (MongoDB $text + Gemini) ===');
  console.log('NOTE: Corpus is 100% synthetic (15 support articles, 30 fixed questions).');

  // Load ground truth
  const groundTruthPath = path.join(__dirname, 'rag_ground_truth.json');
  const groundTruth = JSON.parse(fs.readFileSync(groundTruthPath, 'utf-8'));

  await mongoose.connect(env.MONGODB_URI);

  // Create isolated evaluation workspace
  const evalWs = await Workspace.create({
    name: 'RAG Synthetic Evaluation Workspace',
    publicKey: `pk_rag_eval_${Date.now()}`,
    joinCode: 'RAGEVL',
    owner: new mongoose.Types.ObjectId()
  });

  console.log(`Created evaluation workspace: ${evalWs._id}`);

  // Map from ground truth article id to created Article document
  const articleDocMap = new Map();
  for (const art of groundTruth.articles) {
    const doc = await Article.create({
      workspace: evalWs._id,
      title: art.title,
      content: art.content
    });
    articleDocMap.set(art.id, doc);
  }

  // Ensure text index is fully synced and built
  await Article.syncIndexes();
  console.log(`Seeded ${articleDocMap.size} synthetic articles and synced text index.`);

  // --- PART 1: MongoDB $text Retrieval Evaluation ---
  console.log('\n--- Evaluating MongoDB $text Search (Top-1 & Top-3 Hit Rates) ---');

  // 1 Warm-up run over all 30 questions
  console.log('Running 1 warm-up run over all 30 questions...');
  for (const q of groundTruth.questions) {
    await findRelevantArticles(evalWs._id, q.query, 3);
  }

  // 5 Measured runs over all 30 questions
  const MEASURED_RUNS = 5;
  const retrievalLatencies = [];
  const questionStats = new Map();

  for (const q of groundTruth.questions) {
    questionStats.set(q.id, {
      id: q.id,
      query: q.query,
      difficulty: q.difficulty,
      expectedArticleId: q.expectedArticleId,
      expectedTitle: groundTruth.articles.find((a) => a.id === q.expectedArticleId)?.title,
      top1Hits: 0,
      top3Hits: 0,
      totalRuns: 0,
      lastRetrieved: []
    });
  }

  let totalTop1Hits = 0;
  let totalTop3Hits = 0;
  let totalRetrievalEvaluations = 0;

  for (let run = 1; run <= MEASURED_RUNS; run++) {
    for (const q of groundTruth.questions) {
      const expectedDoc = articleDocMap.get(q.expectedArticleId);
      const expectedDocIdStr = expectedDoc._id.toString();

      const t0 = performance.now();
      const articles = await findRelevantArticles(evalWs._id, q.query, 3);
      const t1 = performance.now();
      const latencyMs = t1 - t0;

      retrievalLatencies.push(latencyMs);
      totalRetrievalEvaluations++;

      const isTop1 = articles.length > 0 && articles[0]._id.toString() === expectedDocIdStr;
      const isTop3 = articles.some((a) => a._id.toString() === expectedDocIdStr);

      if (isTop1) totalTop1Hits++;
      if (isTop3) totalTop3Hits++;

      const stat = questionStats.get(q.id);
      stat.totalRuns++;
      if (isTop1) stat.top1Hits++;
      if (isTop3) stat.top3Hits++;
      if (run === MEASURED_RUNS) {
        stat.lastRetrieved = articles.map((a, idx) => ({
          rank: idx + 1,
          title: a.title,
          isMatch: a._id.toString() === expectedDocIdStr
        }));
      }
    }
  }

  const overallTop1Rate = (totalTop1Hits / totalRetrievalEvaluations) * 100;
  const overallTop3Rate = (totalTop3Hits / totalRetrievalEvaluations) * 100;

  // Breakdown by difficulty
  const difficultyBreakdown = {};
  for (const stat of questionStats.values()) {
    const diff = stat.difficulty;
    if (!difficultyBreakdown[diff]) {
      difficultyBreakdown[diff] = { count: 0, top1Hits: 0, top3Hits: 0, totalEvals: 0 };
    }
    difficultyBreakdown[diff].count++;
    difficultyBreakdown[diff].top1Hits += stat.top1Hits;
    difficultyBreakdown[diff].top3Hits += stat.top3Hits;
    difficultyBreakdown[diff].totalEvals += stat.totalRuns;
  }

  for (const [diff, data] of Object.entries(difficultyBreakdown)) {
    data.top1Percentage = ((data.top1Hits / data.totalEvals) * 100).toFixed(1);
    data.top3Percentage = ((data.top3Hits / data.totalEvals) * 100).toFixed(1);
  }

  const retrievalP50 = computePercentile(retrievalLatencies, 50);
  const retrievalP95 = computePercentile(retrievalLatencies, 95);
  const retrievalP99 = computePercentile(retrievalLatencies, 99);

  console.log(`\nRetrieval Evaluation Results (n = ${totalRetrievalEvaluations} queries over 5 runs):`);
  console.log(`  Top-1 Hit Rate: ${overallTop1Rate.toFixed(1)}% (${totalTop1Hits}/${totalRetrievalEvaluations})`);
  console.log(`  Top-3 Hit Rate: ${overallTop3Rate.toFixed(1)}% (${totalTop3Hits}/${totalRetrievalEvaluations})`);
  console.log(`  Retrieval Latency (ms): Median=${retrievalP50.toFixed(2)}ms, p95=${retrievalP95.toFixed(2)}ms, p99=${retrievalP99.toFixed(2)}ms`);

  console.log('\nHit Rate Breakdown by Difficulty:');
  for (const [diff, data] of Object.entries(difficultyBreakdown)) {
    console.log(`  - ${diff.toUpperCase()} (n=${data.count}): Top-1=${data.top1Percentage}%, Top-3=${data.top3Percentage}%`);
  }

  // --- PART 2: Gemini & End-to-End Latency Evaluation ---
  console.log('\n--- Evaluating Gemini & Total End-to-End Latency ---');
  console.log(`Gemini API configured model: ${env.GEMINI_MODEL}`);

  // Test question for end-to-end RAG latency
  const sampleQuestion = groundTruth.questions.find((q) => q.id === 'q05'); // Refund policy query
  const sampleArticles = await findRelevantArticles(evalWs._id, sampleQuestion.query, 3);

  const sampleMessages = [
    { senderType: 'customer', senderName: 'Alice', text: sampleQuestion.query }
  ];

  // 1 Warm-up run for Gemini
  console.log('Running 1 warm-up run for Gemini API...');
  const warmupT0 = performance.now();
  await suggestReply({
    conversation: { _id: new mongoose.Types.ObjectId() },
    messages: sampleMessages,
    articles: sampleArticles
  });
  const warmupMs = performance.now() - warmupT0;
  console.log(`Warm-up run completed in ${warmupMs.toFixed(2)} ms. Waiting 4s to prevent rate limiting...`);
  await new Promise((r) => setTimeout(r, 4000));

  // 5 Measured runs for Gemini
  const geminiLatencies = [];
  const endToEndLatencies = [];
  const geminiOutputs = [];

  for (let i = 1; i <= 5; i++) {
    console.log(`Executing measured Gemini run ${i}/5...`);

    // Measure retrieval time for this run
    const rStart = performance.now();
    const retrieved = await findRelevantArticles(evalWs._id, sampleQuestion.query, 3);
    const rEnd = performance.now();
    const retLatency = rEnd - rStart;

    // Measure Gemini generation time
    const gStart = performance.now();
    const suggestion = await suggestReply({
      conversation: { _id: new mongoose.Types.ObjectId() },
      messages: sampleMessages,
      articles: retrieved
    });
    const gEnd = performance.now();
    const gemLatency = gEnd - gStart;
    const totalLatency = retLatency + gemLatency;

    geminiLatencies.push(gemLatency);
    endToEndLatencies.push(totalLatency);
    geminiOutputs.push(suggestion);

    console.log(`  Run ${i}: Retrieval=${retLatency.toFixed(2)}ms, Gemini=${gemLatency.toFixed(2)}ms, Total=${totalLatency.toFixed(2)}ms`);

    if (i < 5) {
      await new Promise((r) => setTimeout(r, 4500)); // Respect Google AI Studio rate limits
    }
  }

  const geminiP50 = computePercentile(geminiLatencies, 50);
  const geminiP95 = computePercentile(geminiLatencies, 95);

  const totalP50 = computePercentile(endToEndLatencies, 50);
  const totalP95 = computePercentile(endToEndLatencies, 95);

  console.log(`\nGemini API Latency (5 runs): Median=${geminiP50.toFixed(2)}ms, p95=${geminiP95.toFixed(2)}ms`);
  console.log(`Total End-to-End Latency (5 runs): Median=${totalP50.toFixed(2)}ms, p95=${totalP95.toFixed(2)}ms`);

  // Identify weak spots / failure cases in retrieval
  const failureCases = [];
  for (const stat of questionStats.values()) {
    if (stat.top3Hits < stat.totalRuns) {
      failureCases.push({
        id: stat.id,
        query: stat.query,
        difficulty: stat.difficulty,
        expectedArticle: stat.expectedTitle,
        top1HitRate: `${((stat.top1Hits / stat.totalRuns) * 100).toFixed(0)}%`,
        top3HitRate: `${((stat.top3Hits / stat.totalRuns) * 100).toFixed(0)}%`,
        retrievedArticles: stat.lastRetrieved.map((r) => `[Rank ${r.rank}] ${r.title} (match=${r.isMatch})`),
        likelyCause:
          stat.difficulty === 'hard'
            ? 'Deliberate vocabulary mismatch; MongoDB text search relies on Porter stemming and lexical exact matching without dense semantic vector embeddings.'
            : 'Synonym divergence where query keywords lack overlapping token stems with article title/content.'
      });
    }
  }

  console.log(`\nIdentified ${failureCases.length} retrieval failure/degradation cases out of 30 questions.`);

  // Clean up
  await Workspace.deleteMany({ _id: evalWs._id });
  await Article.deleteMany({ workspace: evalWs._id });
  await mongoose.disconnect();

  const resultsData = {
    testDate: new Date().toISOString(),
    corpus: {
      type: 'synthetic',
      articleCount: groundTruth.articles.length,
      questionCount: groundTruth.questions.length,
      runsPerQuestion: MEASURED_RUNS,
      totalRetrievalEvaluations
    },
    retrievalMetrics: {
      overallTop1HitRate: Number(overallTop1Rate.toFixed(1)),
      overallTop3HitRate: Number(overallTop3Rate.toFixed(1)),
      latencyMs: {
        median: Number(retrievalP50.toFixed(2)),
        p95: Number(retrievalP95.toFixed(2)),
        p99: Number(retrievalP99.toFixed(2))
      },
      difficultyBreakdown
    },
    geminiMetrics: {
      model: env.GEMINI_MODEL,
      measuredRuns: 5,
      geminiLatencyMs: {
        median: Number(geminiP50.toFixed(2)),
        p95: Number(geminiP95.toFixed(2)),
        samples: geminiLatencies.map((l) => Number(l.toFixed(2)))
      },
      totalLatencyMs: {
        median: Number(totalP50.toFixed(2)),
        p95: Number(totalP95.toFixed(2)),
        samples: endToEndLatencies.map((l) => Number(l.toFixed(2)))
      },
      sampleSuggestion: geminiOutputs[0]
    },
    failureCases,
    rawQuestionResults: Array.from(questionStats.values())
  };

  const resultsDir = path.resolve(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  fs.writeFileSync(path.join(resultsDir, 'rag.json'), JSON.stringify(resultsData, null, 2), 'utf-8');

  let textReport = `=== Step 5: RAG Evaluation Report ===
Date: ${resultsData.testDate}
Corpus: Synthetic support knowledge base (15 articles, 30 fixed questions, 5 hard)
Retrieval Engine: MongoDB 8.3.7 $text index on { title: 'text', content: 'text' }
LLM Engine: Google Gemini API (${env.GEMINI_MODEL})

1. Retrieval Accuracy (n = ${totalRetrievalEvaluations} across 5 measured runs):
   - Top-1 Hit Rate: ${overallTop1Rate.toFixed(1)}% (${totalTop1Hits} / ${totalRetrievalEvaluations})
   - Top-3 Hit Rate: ${overallTop3Rate.toFixed(1)}% (${totalTop3Hits} / ${totalRetrievalEvaluations})

   Accuracy by Difficulty:
   - Direct questions: Top-1 = ${difficultyBreakdown.direct?.top1Percentage}%, Top-3 = ${difficultyBreakdown.direct?.top3Percentage}% (n = ${difficultyBreakdown.direct?.count})
   - Paraphrased: Top-1 = ${difficultyBreakdown.paraphrased?.top1Percentage}%, Top-3 = ${difficultyBreakdown.paraphrased?.top3Percentage}% (n = ${difficultyBreakdown.paraphrased?.count})
   - Synonyms: Top-1 = ${difficultyBreakdown.synonym?.top1Percentage}%, Top-3 = ${difficultyBreakdown.synonym?.top3Percentage}% (n = ${difficultyBreakdown.synonym?.count})
   - Deliberately Hard: Top-1 = ${difficultyBreakdown.hard?.top1Percentage}%, Top-3 = ${difficultyBreakdown.hard?.top3Percentage}% (n = ${difficultyBreakdown.hard?.count})

2. Timing & Latencies (1 warm-up, 5 measured runs):
   - Retrieval Latency (MongoDB $text): Median = ${retrievalP50.toFixed(2)} ms | p95 = ${retrievalP95.toFixed(2)} ms | p99 = ${retrievalP99.toFixed(2)} ms (n = 150)
   - Gemini Generation Latency: Median = ${geminiP50.toFixed(2)} ms | p95 = ${geminiP95.toFixed(2)} ms (n = 5)
   - Total End-to-End Latency: Median = ${totalP50.toFixed(2)} ms | p95 = ${totalP95.toFixed(2)} ms (n = 5)

3. Retrieval Failure Cases & Weak Spots Analysis:
`;

  for (const fc of failureCases) {
    textReport += `\n[${fc.id}] Query: "${fc.query}"\n`;
    textReport += `  Category: ${fc.difficulty}\n`;
    textReport += `  Expected: ${fc.expectedArticle}\n`;
    textReport += `  Top-1 Hit Rate: ${fc.top1HitRate} | Top-3 Hit Rate: ${fc.top3HitRate}\n`;
    textReport += `  Retrieved: ${fc.retrievedArticles.join(', ') || 'No articles retrieved'}\n`;
    textReport += `  Root Cause: ${fc.likelyCause}\n`;
  }

  fs.writeFileSync(path.join(resultsDir, 'rag.txt'), textReport, 'utf-8');
  console.log('Saved raw results to eval/results/rag.json and eval/results/rag.txt');

  return resultsData;
}

runRagEvaluation().catch((err) => {
  console.error('RAG evaluation failed:', err);
  process.exit(1);
});
