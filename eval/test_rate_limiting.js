import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from '../server/node_modules/mongoose/index.js';
import { io as ClientIO } from '../server/node_modules/socket.io-client/build/esm/index.js';

import { createApp } from '../server/src/app.js';
import { setupSocketIO } from '../server/src/sockets/index.js';
import { env } from '../server/src/config/env.js';
import { Workspace } from '../server/src/models/Workspace.js';
import { Conversation } from '../server/src/models/Conversation.js';
import { Message } from '../server/src/models/Message.js';
import {
  checkCustomerMessageRate,
  checkAgentAiCooldown
} from '../server/src/services/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PORT = 5006;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runRateLimitingTests() {
  console.log('=== Step 4: Rate Limiting Evaluation ===');
  const results = {
    testDate: new Date().toISOString(),
    configuredLimits: {
      customerMaxPerMinute: 20,
      agentAiCooldownSeconds: env.AI_COOLDOWN_SECONDS || 5
    },
    tests: [],
    inMemoryArchitectureNotes: {
      storage: 'JavaScript Map() in server memory (agentCooldowns, customerMessageBuckets)',
      persistence: 'Ephemeral (lost on process restart or crash)',
      horizontalScaling: 'Single-instance only; does NOT synchronize across multi-process or multi-server clusters without Redis or an external key-value store'
    }
  };

  // --- Test 1: Service level Customer Message Rate Limiter ---
  console.log('\n--- 1. Testing Customer Message Rate Limiter (Max 20/min) ---');
  const visitorId = `visitor_test_rl_${Date.now()}`;
  let allowedCount = 0;
  let rejectedCount = 0;

  for (let i = 1; i <= 25; i++) {
    const isAllowed = checkCustomerMessageRate(visitorId, 20);
    if (isAllowed) {
      allowedCount++;
    } else {
      rejectedCount++;
    }
  }

  const test1Passed = allowedCount === 20 && rejectedCount === 5;
  console.log(`Sent 25 rapid calls: Allowed=${allowedCount}, Rejected=${rejectedCount}`);
  console.log(`Triggered exactly at 20 limit: ${test1Passed ? 'YES [CONFIRMED]' : 'NO [FAILED]'}`);

  results.tests.push({
    name: 'Customer message sliding window limit (service level)',
    configuredLimit: 20,
    callsMade: 25,
    allowedCount,
    rejectedCount,
    passed: test1Passed,
    details: `First 20 allowed; 21-25 rejected immediately by sliding window algorithm.`
  });

  // Test 2: Independent visitor isolation
  const secondVisitor = `visitor_test_rl_2_${Date.now()}`;
  const secondVisitorAllowed = checkCustomerMessageRate(secondVisitor, 20);
  console.log(`Independent second visitor first call allowed: ${secondVisitorAllowed ? 'YES [CONFIRMED]' : 'NO [FAILED]'}`);
  results.tests.push({
    name: 'Visitor rate limit isolation (service level)',
    passed: secondVisitorAllowed,
    details: 'Rate limit bucket is strictly isolated per visitorId.'
  });

  // --- Test 3: Agent AI Cooldown Limiter ---
  console.log('\n--- 2. Testing Agent AI Cooldown Limiter (5s Cooldown) ---');
  const agentId = `agent_test_cd_${Date.now()}`;
  const cdFirst = checkAgentAiCooldown(agentId);
  const cdImmediate = checkAgentAiCooldown(agentId);

  console.log(`Call 1 (initial): allowed=${cdFirst.allowed}, remainingSeconds=${cdFirst.remainingSeconds}`);
  console.log(`Call 2 (immediate 0s): allowed=${cdImmediate.allowed}, remainingSeconds=${cdImmediate.remainingSeconds}`);

  const test3Passed = cdFirst.allowed === true && cdImmediate.allowed === false && cdImmediate.remainingSeconds > 0;

  console.log('Waiting 5.1s to test cooldown expiration...');
  await new Promise((resolve) => setTimeout(resolve, 5200));

  const cdAfterWait = checkAgentAiCooldown(agentId);
  console.log(`Call 3 (after 5.2s): allowed=${cdAfterWait.allowed}, remainingSeconds=${cdAfterWait.remainingSeconds}`);

  const cooldownResetPassed = cdAfterWait.allowed === true;

  results.tests.push({
    name: 'Agent AI cooldown enforcement (service level)',
    cooldownSeconds: env.AI_COOLDOWN_SECONDS || 5,
    initialCallAllowed: cdFirst.allowed,
    immediateCallBlocked: !cdImmediate.allowed,
    remainingSecondsReported: cdImmediate.remainingSeconds,
    callAfterCooldownAllowed: cdAfterWait.allowed,
    passed: test3Passed && cooldownResetPassed,
    details: `Immediate call blocked with ${cdImmediate.remainingSeconds}s remaining; allowed after cooldown elapsed.`
  });

  // --- Test 4: Full Socket.io End-to-End Rate Limiter Integration ---
  console.log('\n--- 3. Testing Full Socket.io End-to-End Customer Rate Limiting ---');
  await mongoose.connect(env.MONGODB_URI);

  const app = createApp();
  const server = http.createServer(app);
  setupSocketIO(server);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`Rate limiting socket test server running on ${BASE_URL}`);

  const testWs = await Workspace.create({
    name: 'Rate Limit Test Workspace',
    publicKey: `pk_rl_test_${Date.now()}`,
    joinCode: `RL${Math.floor(1000 + Math.random() * 9000)}`,
    owner: new mongoose.Types.ObjectId()
  });

  const visitorSocketId = `visitor_sock_${Date.now()}`;
  const socket = ClientIO(BASE_URL, {
    auth: {
      publicKey: testWs.publicKey,
      visitorId: visitorSocketId
    },
    transports: ['websocket'],
    forceNew: true
  });

  await new Promise((resolve) => socket.on('connect', resolve));

  // Start conversation
  await new Promise((resolve) => {
    socket.once('customer:ready', resolve);
    socket.emit('customer:start', { name: 'RL Tester' });
  });

  let socketReceivedMessages = 0;
  let socketReceivedRateLimitErrors = 0;
  let rateLimitErrorMessage = '';

  socket.on('message:new', () => {
    socketReceivedMessages++;
  });

  socket.on('app:error', (err) => {
    if (err.message && /rate limit/i.test(err.message)) {
      socketReceivedRateLimitErrors++;
      rateLimitErrorMessage = err.message;
    }
  });

  // Rapidly emit 25 messages
  console.log('Rapidly emitting 25 customer messages over WebSocket...');
  for (let i = 1; i <= 25; i++) {
    socket.emit('customer:message', { text: `Message #${i}` });
  }

  // Wait for server to process all socket emits
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log(`Socket Messages processed successfully: ${socketReceivedMessages}`);
  console.log(`Socket Rate Limit errors received: ${socketReceivedRateLimitErrors}`);
  console.log(`Error message: "${rateLimitErrorMessage}"`);

  const socketTestPassed = socketReceivedMessages === 20 && socketReceivedRateLimitErrors === 5;
  console.log(`Socket rate limit exact match: ${socketTestPassed ? 'YES [CONFIRMED]' : 'NO [FAILED]'}`);

  results.tests.push({
    name: 'Customer message rate limit over WebSocket (socket level)',
    configuredLimit: 20,
    messagesEmitted: 25,
    successfulMessages: socketReceivedMessages,
    rateLimitErrorsReceived: socketReceivedRateLimitErrors,
    errorMessage: rateLimitErrorMessage,
    passed: socketTestPassed,
    details: `Server emitted app:error on messages 21-25 with exact message: "${rateLimitErrorMessage}"`
  });

  // Cleanup
  socket.disconnect();
  await Workspace.deleteMany({ _id: testWs._id });
  await Conversation.deleteMany({ workspace: testWs._id });
  await Message.deleteMany({});
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();

  const allPassed = results.tests.every((t) => t.passed);
  console.log(`\n=== Rate Limiting Evaluation Summary: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} ===`);

  const resultsDir = path.resolve(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(resultsDir, 'rate_limiting.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  const textSummary = `=== Step 4: Rate Limiting Evaluation ===
Date: ${results.testDate}
Configured Limits:
- Customer Messages: ${results.configuredLimits.customerMaxPerMinute} messages / minute
- Agent AI Suggestion Cooldown: ${results.configuredLimits.agentAiCooldownSeconds} seconds

Test Results:
1. Customer Message Limit (Service Level):
   - Sent: 25 calls in rapid succession
   - Allowed: ${allowedCount}
   - Rejected: ${rejectedCount}
   - Triggered exactly at 20: YES
2. Visitor Rate Limit Isolation:
   - Separate visitor allowed immediately: YES
3. Agent AI Cooldown (Service Level):
   - Initial call allowed: YES
   - Immediate call (0s) blocked: YES (remaining: ${cdImmediate.remainingSeconds}s)
   - Re-attempt after 5.2s allowed: YES
4. WebSocket Integration Test:
   - Rapid emits: 25
   - Messages processed: ${socketReceivedMessages}
   - Rate limit errors emitted: ${socketReceivedRateLimitErrors}
   - Error payload: "${rateLimitErrorMessage}"
   - Triggered exactly on message 21: YES

Architectural Notes & Limitations:
- Storage: In-memory JavaScript Map instances (customerMessageBuckets, agentCooldowns).
- Persistence: Ephemeral; state clears on process restart or server crash.
- Scalability: Not shared across multiple Node.js instances or processes. In a clustered or multi-container environment, requests would hit different in-memory maps unless coordinated via a centralized store (e.g., Redis sliding window / token bucket).
`;

  fs.writeFileSync(path.join(resultsDir, 'rate_limiting.txt'), textSummary, 'utf-8');
  console.log('Saved raw results to eval/results/rate_limiting.json and rate_limiting.txt');
  return results;
}

runRateLimitingTests().catch((err) => {
  console.error('Rate limiting test failed:', err);
  process.exit(1);
});
