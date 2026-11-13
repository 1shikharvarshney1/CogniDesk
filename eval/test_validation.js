import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from '../server/node_modules/mongoose/index.js';
import jwt from '../server/node_modules/jsonwebtoken/index.js';
import { io as ClientIO } from '../server/node_modules/socket.io-client/build/esm/index.js';

import { createApp } from '../server/src/app.js';
import { setupSocketIO } from '../server/src/sockets/index.js';
import { env } from '../server/src/config/env.js';
import { User } from '../server/src/models/User.js';
import { Workspace } from '../server/src/models/Workspace.js';
import { Conversation } from '../server/src/models/Conversation.js';
import { Article } from '../server/src/models/Article.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PORT = 5007;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function signToken(userId) {
  return jwt.sign({ id: userId }, env.JWT_SECRET, { expiresIn: '1h' });
}

async function runValidationTests() {
  console.log('=== Step 6: Input Validation Evaluation ===');
  await mongoose.connect(env.MONGODB_URI);

  const app = createApp();
  const server = http.createServer(app);
  setupSocketIO(server);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`Validation test server running on ${BASE_URL}`);

  // Seed user and workspace for authenticated tests
  const testUser = await User.create({
    username: 'validTester',
    email: `valid_tester_${Date.now()}@example.com`,
    passwordHash: 'dummy_hash'
  });

  const testWs = await Workspace.create({
    name: 'Validation Test Workspace',
    publicKey: `pk_val_${Date.now()}`,
    joinCode: 'VAL123',
    owner: testUser._id
  });

  testUser.workspace = testWs._id;
  await testUser.save();

  const token = signToken(testUser._id);

  const testArt = await Article.create({
    workspace: testWs._id,
    title: 'Initial Article',
    content: 'Initial content for testing updates.'
  });

  const testConv = await Conversation.create({
    workspace: testWs._id,
    visitorId: `visitor_val_${Date.now()}`,
    customerName: 'Val Customer',
    status: 'open'
  });

  const testCases = [
    // --- POST /api/auth/register ---
    {
      id: 'V01',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Username < 2 chars',
      payload: { username: 'a', email: 'valid@example.com', password: 'password123' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V02',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Empty username',
      payload: { username: '', email: 'valid@example.com', password: 'password123' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V03',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Invalid email format (no domain)',
      payload: { username: 'validUser', email: 'not-an-email', password: 'password123' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V04',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Invalid email format (no user)',
      payload: { username: 'validUser', email: '@missing-user.com', password: 'password123' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V05',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Password < 6 characters',
      payload: { username: 'validUser', email: 'valid@example.com', password: '123' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V06',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Missing username field',
      payload: { email: 'valid@example.com', password: 'password123' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V07',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Missing email field',
      payload: { username: 'validUser', password: 'password123' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V08',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Missing password field',
      payload: { username: 'validUser', email: 'valid@example.com' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V09',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Empty JSON object',
      payload: {},
      expectedStatus: 400,
      schema: 'registerSchema'
    },
    {
      id: 'V10',
      endpoint: 'POST /api/auth/register',
      protocol: 'REST',
      description: 'Non-string username (number)',
      payload: { username: 12345, email: 'valid@example.com', password: 'password123' },
      expectedStatus: 400,
      schema: 'registerSchema'
    },

    // --- POST /api/auth/login ---
    {
      id: 'V11',
      endpoint: 'POST /api/auth/login',
      protocol: 'REST',
      description: 'Invalid email format',
      payload: { email: 'invalid-email', password: 'password123' },
      expectedStatus: 400,
      schema: 'loginSchema'
    },
    {
      id: 'V12',
      endpoint: 'POST /api/auth/login',
      protocol: 'REST',
      description: 'Empty password string',
      payload: { email: 'valid@example.com', password: '' },
      expectedStatus: 400,
      schema: 'loginSchema'
    },
    {
      id: 'V13',
      endpoint: 'POST /api/auth/login',
      protocol: 'REST',
      description: 'Missing email field',
      payload: { password: 'password123' },
      expectedStatus: 400,
      schema: 'loginSchema'
    },
    {
      id: 'V14',
      endpoint: 'POST /api/auth/login',
      protocol: 'REST',
      description: 'Missing password field',
      payload: { email: 'valid@example.com' },
      expectedStatus: 400,
      schema: 'loginSchema'
    },

    // --- POST /api/workspaces ---
    {
      id: 'V15',
      endpoint: 'POST /api/workspaces',
      protocol: 'REST',
      description: 'Empty workspace name',
      payload: { name: '' },
      expectedStatus: 400,
      auth: true,
      schema: 'createWorkspaceSchema'
    },
    {
      id: 'V16',
      endpoint: 'POST /api/workspaces',
      protocol: 'REST',
      description: 'Workspace name < 2 chars',
      payload: { name: 'A' },
      expectedStatus: 400,
      auth: true,
      schema: 'createWorkspaceSchema'
    },
    {
      id: 'V17',
      endpoint: 'POST /api/workspaces',
      protocol: 'REST',
      description: 'Missing workspace name field',
      payload: {},
      expectedStatus: 400,
      auth: true,
      schema: 'createWorkspaceSchema'
    },
    {
      id: 'V18',
      endpoint: 'POST /api/workspaces',
      protocol: 'REST',
      description: 'Non-string workspace name',
      payload: { name: 9876 },
      expectedStatus: 400,
      auth: true,
      schema: 'createWorkspaceSchema'
    },

    // --- POST /api/workspaces/join ---
    {
      id: 'V19',
      endpoint: 'POST /api/workspaces/join',
      protocol: 'REST',
      description: 'Join code < 6 chars',
      payload: { joinCode: 'ABC' },
      expectedStatus: 400,
      auth: true,
      schema: 'joinWorkspaceSchema'
    },
    {
      id: 'V20',
      endpoint: 'POST /api/workspaces/join',
      protocol: 'REST',
      description: 'Missing join code field',
      payload: {},
      expectedStatus: 400,
      auth: true,
      schema: 'joinWorkspaceSchema'
    },

    // --- POST /api/articles ---
    {
      id: 'V21',
      endpoint: 'POST /api/articles',
      protocol: 'REST',
      description: 'Empty article title',
      payload: { title: '', content: 'Valid article content' },
      expectedStatus: 400,
      auth: true,
      schema: 'articleSchema'
    },
    {
      id: 'V22',
      endpoint: 'POST /api/articles',
      protocol: 'REST',
      description: 'Missing article title',
      payload: { content: 'Valid article content' },
      expectedStatus: 400,
      auth: true,
      schema: 'articleSchema'
    },
    {
      id: 'V23',
      endpoint: 'POST /api/articles',
      protocol: 'REST',
      description: 'Empty article content',
      payload: { title: 'Valid Title', content: '' },
      expectedStatus: 400,
      auth: true,
      schema: 'articleSchema'
    },
    {
      id: 'V24',
      endpoint: 'POST /api/articles',
      protocol: 'REST',
      description: 'Missing article content',
      payload: { title: 'Valid Title' },
      expectedStatus: 400,
      auth: true,
      schema: 'articleSchema'
    },
    {
      id: 'V25',
      endpoint: 'POST /api/articles',
      protocol: 'REST',
      description: 'Article content exceeds 4000 characters',
      payload: { title: 'Valid Title', content: 'x'.repeat(4001) },
      expectedStatus: 400,
      auth: true,
      schema: 'articleSchema'
    },
    {
      id: 'V26',
      endpoint: 'POST /api/articles',
      protocol: 'REST',
      description: 'Non-string article title',
      payload: { title: 12345, content: 'Valid content' },
      expectedStatus: 400,
      auth: true,
      schema: 'articleSchema'
    },

    // --- PUT /api/articles/:id ---
    {
      id: 'V27',
      endpoint: `PUT /api/articles/:id`,
      protocol: 'REST',
      description: 'Update article with empty title',
      payload: { title: '', content: 'Updated content' },
      expectedStatus: 400,
      auth: true,
      articleId: testArt._id,
      schema: 'articleSchema'
    },
    {
      id: 'V28',
      endpoint: `PUT /api/articles/:id`,
      protocol: 'REST',
      description: 'Update article with content > 4000 chars',
      payload: { title: 'Updated Title', content: 'z'.repeat(4001) },
      expectedStatus: 400,
      auth: true,
      articleId: testArt._id,
      schema: 'articleSchema'
    }
  ];

  const results = [];

  // Execute REST Validation Test Cases
  for (const tc of testCases) {
    const url = tc.articleId
      ? `${BASE_URL}/api/articles/${tc.articleId}`
      : `${BASE_URL}${tc.endpoint.split(' ')[1]}`;

    const headers = { 'Content-Type': 'application/json' };
    if (tc.auth) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, {
        method: tc.endpoint.split(' ')[0],
        headers,
        body: JSON.stringify(tc.payload)
      });

      const body = await res.json().catch(() => ({}));
      const correctlyRejected = res.status === tc.expectedStatus;

      results.push({
        id: tc.id,
        endpoint: tc.endpoint,
        protocol: tc.protocol,
        description: tc.description,
        schema: tc.schema,
        expectedStatus: tc.expectedStatus,
        actualStatus: res.status,
        correctlyRejected,
        errorMessage: body.message || JSON.stringify(body)
      });

      const mark = correctlyRejected ? '[REJECTED OK]' : '[FAILED]';
      console.log(` ${mark} ${tc.id}: ${tc.endpoint} - ${tc.description} (status: ${res.status})`);
    } catch (err) {
      results.push({
        id: tc.id,
        endpoint: tc.endpoint,
        protocol: tc.protocol,
        description: tc.description,
        schema: tc.schema,
        expectedStatus: tc.expectedStatus,
        actualStatus: 'FETCH_ERROR',
        correctlyRejected: false,
        errorMessage: err.message
      });
    }
  }

  // --- WebSocket Validation Tests ---
  console.log('\n--- WebSocket Handshake & Payload Validation Tests ---');

  // V29: Malformed JWT in handshake
  {
    let connectErr = null;
    const badJwtSocket = ClientIO(BASE_URL, {
      auth: { token: 'malformed.jwt.token' },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });

    await new Promise((resolve) => {
      badJwtSocket.on('connect_error', (err) => {
        connectErr = err;
        resolve();
      });
      badJwtSocket.on('connect', resolve);
      setTimeout(resolve, 2000);
    });
    badJwtSocket.disconnect();

    const correctlyRejected = connectErr && /Unauthorized/i.test(connectErr.message);
    results.push({
      id: 'V29',
      endpoint: 'WS Handshake (Agent)',
      protocol: 'WebSocket',
      description: 'Malformed JWT token in handshake',
      schema: 'jwt.verify',
      expectedStatus: 'connect_error',
      actualStatus: connectErr ? connectErr.message : 'connected',
      correctlyRejected: Boolean(correctlyRejected),
      errorMessage: connectErr ? connectErr.message : 'No error'
    });
    console.log(` ${correctlyRejected ? '[REJECTED OK]' : '[FAILED]'} V29: WS Handshake - Malformed JWT token (${connectErr?.message})`);
  }

  // V30: Non-existent workspace publicKey
  {
    let connectErr = null;
    const badKeySocket = ClientIO(BASE_URL, {
      auth: { publicKey: 'non_existent_key_999999' },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });

    await new Promise((resolve) => {
      badKeySocket.on('connect_error', (err) => {
        connectErr = err;
        resolve();
      });
      badKeySocket.on('connect', resolve);
      setTimeout(resolve, 2000);
    });
    badKeySocket.disconnect();

    const correctlyRejected = connectErr && /Workspace not found/i.test(connectErr.message);
    results.push({
      id: 'V30',
      endpoint: 'WS Handshake (Customer)',
      protocol: 'WebSocket',
      description: 'Invalid / non-existent publicKey in handshake',
      schema: 'Workspace.findOne',
      expectedStatus: 'connect_error',
      actualStatus: connectErr ? connectErr.message : 'connected',
      correctlyRejected: Boolean(correctlyRejected),
      errorMessage: connectErr ? connectErr.message : 'No error'
    });
    console.log(` ${correctlyRejected ? '[REJECTED OK]' : '[FAILED]'} V30: WS Handshake - Invalid publicKey (${connectErr?.message})`);
  }

  // V31: Empty auth credentials in handshake
  {
    let connectErr = null;
    const emptyAuthSocket = ClientIO(BASE_URL, {
      auth: {},
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });

    await new Promise((resolve) => {
      emptyAuthSocket.on('connect_error', (err) => {
        connectErr = err;
        resolve();
      });
      emptyAuthSocket.on('connect', resolve);
      setTimeout(resolve, 2000);
    });
    emptyAuthSocket.disconnect();

    const correctlyRejected = connectErr && /Unauthorized/i.test(connectErr.message);
    results.push({
      id: 'V31',
      endpoint: 'WS Handshake',
      protocol: 'WebSocket',
      description: 'Missing credentials in handshake',
      schema: 'io.use auth middleware',
      expectedStatus: 'connect_error',
      actualStatus: connectErr ? connectErr.message : 'connected',
      correctlyRejected: Boolean(correctlyRejected),
      errorMessage: connectErr ? connectErr.message : 'No error'
    });
    console.log(` ${correctlyRejected ? '[REJECTED OK]' : '[FAILED]'} V31: WS Handshake - Missing credentials (${connectErr?.message})`);
  }

  // Connect valid sockets for message payload validation
  const validCustSocket = ClientIO(BASE_URL, {
    auth: { publicKey: testWs.publicKey, visitorId: testConv.visitorId },
    transports: ['websocket'],
    forceNew: true
  });
  const validAgentSocket = ClientIO(BASE_URL, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true
  });

  await Promise.all([
    new Promise((resolve) => validCustSocket.on('connect', resolve)),
    new Promise((resolve) => validAgentSocket.on('connect', resolve))
  ]);

  await new Promise((resolve) => {
    validCustSocket.once('customer:ready', resolve);
    validCustSocket.emit('customer:start', { name: 'Val Tester' });
  });

  // V32: Customer message empty text
  {
    const errPromise = new Promise((resolve) => {
      validCustSocket.once('app:error', (err) => resolve(err));
      setTimeout(() => resolve(null), 1500);
    });
    validCustSocket.emit('customer:message', { text: '' });
    const err = await errPromise;
    const correctlyRejected = err && /empty/i.test(err.message);
    results.push({
      id: 'V32',
      endpoint: 'WS customer:message',
      protocol: 'WebSocket',
      description: 'Empty customer message text string',
      schema: 'saveMessage text validator',
      expectedStatus: 'app:error',
      actualStatus: err ? err.message : 'none',
      correctlyRejected: Boolean(correctlyRejected),
      errorMessage: err ? err.message : 'No error'
    });
    console.log(` ${correctlyRejected ? '[REJECTED OK]' : '[FAILED]'} V32: customer:message - Empty text (${err?.message})`);
  }

  // V33: Customer message whitespace only
  {
    const errPromise = new Promise((resolve) => {
      validCustSocket.once('app:error', (err) => resolve(err));
      setTimeout(() => resolve(null), 1500);
    });
    validCustSocket.emit('customer:message', { text: '     ' });
    const err = await errPromise;
    const correctlyRejected = err && /empty/i.test(err.message);
    results.push({
      id: 'V33',
      endpoint: 'WS customer:message',
      protocol: 'WebSocket',
      description: 'Whitespace-only customer message text',
      schema: 'saveMessage text validator',
      expectedStatus: 'app:error',
      actualStatus: err ? err.message : 'none',
      correctlyRejected: Boolean(correctlyRejected),
      errorMessage: err ? err.message : 'No error'
    });
    console.log(` ${correctlyRejected ? '[REJECTED OK]' : '[FAILED]'} V33: customer:message - Whitespace only (${err?.message})`);
  }

  // V34: Customer message > 1000 characters
  {
    const errPromise = new Promise((resolve) => {
      validCustSocket.once('app:error', (err) => resolve(err));
      setTimeout(() => resolve(null), 1500);
    });
    validCustSocket.emit('customer:message', { text: 'a'.repeat(1001) });
    const err = await errPromise;
    const correctlyRejected = err && /1000 characters/i.test(err.message);
    results.push({
      id: 'V34',
      endpoint: 'WS customer:message',
      protocol: 'WebSocket',
      description: 'Customer message text exceeding 1000 characters',
      schema: 'saveMessage text validator',
      expectedStatus: 'app:error',
      actualStatus: err ? err.message : 'none',
      correctlyRejected: Boolean(correctlyRejected),
      errorMessage: err ? err.message : 'No error'
    });
    console.log(` ${correctlyRejected ? '[REJECTED OK]' : '[FAILED]'} V34: customer:message - Text > 1000 chars (${err?.message})`);
  }

  // V35: Agent message empty text
  {
    const errPromise = new Promise((resolve) => {
      validAgentSocket.once('app:error', (err) => resolve(err));
      setTimeout(() => resolve(null), 1500);
    });
    validAgentSocket.emit('agent:message', {
      conversationId: testConv._id.toString(),
      text: ''
    });
    const err = await errPromise;
    const correctlyRejected = err && /empty/i.test(err.message);
    results.push({
      id: 'V35',
      endpoint: 'WS agent:message',
      protocol: 'WebSocket',
      description: 'Empty agent message text string',
      schema: 'saveMessage text validator',
      expectedStatus: 'app:error',
      actualStatus: err ? err.message : 'none',
      correctlyRejected: Boolean(correctlyRejected),
      errorMessage: err ? err.message : 'No error'
    });
    console.log(` ${correctlyRejected ? '[REJECTED OK]' : '[FAILED]'} V35: agent:message - Empty text (${err?.message})`);
  }

  // V36: Agent message > 1000 characters
  {
    const errPromise = new Promise((resolve) => {
      validAgentSocket.once('app:error', (err) => resolve(err));
      setTimeout(() => resolve(null), 1500);
    });
    validAgentSocket.emit('agent:message', {
      conversationId: testConv._id.toString(),
      text: 'b'.repeat(1001)
    });
    const err = await errPromise;
    const correctlyRejected = err && /1000 characters/i.test(err.message);
    results.push({
      id: 'V36',
      endpoint: 'WS agent:message',
      protocol: 'WebSocket',
      description: 'Agent message text exceeding 1000 characters',
      schema: 'saveMessage text validator',
      expectedStatus: 'app:error',
      actualStatus: err ? err.message : 'none',
      correctlyRejected: Boolean(correctlyRejected),
      errorMessage: err ? err.message : 'No error'
    });
    console.log(` ${correctlyRejected ? '[REJECTED OK]' : '[FAILED]'} V36: agent:message - Text > 1000 chars (${err?.message})`);
  }

  // Cleanup
  validCustSocket.disconnect();
  validAgentSocket.disconnect();

  await User.deleteMany({ _id: testUser._id });
  await Workspace.deleteMany({ _id: testWs._id });
  await Conversation.deleteMany({ workspace: testWs._id });
  await Article.deleteMany({ workspace: testWs._id });

  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();

  const total = results.length;
  const rejected = results.filter((r) => r.correctlyRejected).length;
  const failed = results.filter((r) => !r.correctlyRejected);

  console.log('\n=== Validation Test Results Summary ===');
  console.log(`Total malformed payloads tested: ${total}`);
  console.log(`Correctly rejected: ${rejected} of ${total} (${((rejected / total) * 100).toFixed(1)}%)`);

  if (failed.length > 0) {
    console.log('Failed to reject:');
    failed.forEach((f) => console.log(`  - ${f.id}: ${f.endpoint} (${f.description})`));
  } else {
    console.log('All malformed payloads were rejected with correct error codes.');
  }

  const resultsDir = path.resolve(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const summary = {
    testDate: new Date().toISOString(),
    totalTested: total,
    correctlyRejectedCount: rejected,
    rejectedPercentage: ((rejected / total) * 100).toFixed(1),
    failedCount: failed.length,
    results
  };

  fs.writeFileSync(path.join(resultsDir, 'validation.json'), JSON.stringify(summary, null, 2), 'utf-8');

  let textOutput = `=== Step 6: Input Validation Evaluation ===
Date: ${summary.testDate}
Total malformed payloads tested (n): ${total}
Correctly rejected by Zod and schema validators: ${rejected} / ${total} (${summary.rejectedPercentage}%)

Detailed Test Cases:
`;
  results.forEach((r) => {
    textOutput += `[${r.correctlyRejected ? 'PASS' : 'FAIL'}] ${r.id} | ${r.protocol} | ${r.endpoint} | ${r.description} -> ${r.actualStatus} | ${r.errorMessage}\n`;
  });

  fs.writeFileSync(path.join(resultsDir, 'validation.txt'), textOutput, 'utf-8');
  console.log('Saved raw results to eval/results/validation.json and validation.txt');

  return summary;
}

runValidationTests().catch((err) => {
  console.error('Validation test failed:', err);
  process.exit(1);
});

