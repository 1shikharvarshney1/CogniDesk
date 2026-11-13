import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { execSync } from 'child_process';
import mongoose from '../server/node_modules/mongoose/index.js';
import jwt from '../server/node_modules/jsonwebtoken/index.js';
import { io as ClientIO } from '../server/node_modules/socket.io-client/build/esm/index.js';

import { env } from '../server/src/config/env.js';
import { User } from '../server/src/models/User.js';
import { Workspace } from '../server/src/models/Workspace.js';
import { Conversation } from '../server/src/models/Conversation.js';
import { Message } from '../server/src/models/Message.js';

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

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    concurrency: 100,
    duration: 60,
    serverUrl: `http://127.0.0.1:${env.PORT || 5000}`,
    serverPid: null,
    output: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--concurrency' && args[i + 1]) {
      config.concurrency = parseInt(args[++i], 10);
    } else if (args[i] === '--duration' && args[i + 1]) {
      config.duration = parseInt(args[++i], 10);
    } else if (args[i] === '--serverUrl' && args[i + 1]) {
      config.serverUrl = args[++i];
    } else if (args[i] === '--serverPid' && args[i + 1]) {
      config.serverPid = parseInt(args[++i], 10);
    } else if (args[i] === '--output' && args[i + 1]) {
      config.output = args[++i];
    }
  }
  return config;
}

function getProcessStats(pid) {
  if (!pid) return null;
  try {
    const cmd = `powershell -NoProfile -Command "Get-Process -Id ${pid} | Select-Object -Property CPU, WorkingSet64 | ConvertTo-Json"`;
    const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 }).toString();
    const data = JSON.parse(out);
    return {
      cpuSeconds: data.CPU || 0,
      memoryBytes: data.WorkingSet64 || 0,
      memoryMB: (data.WorkingSet64 || 0) / (1024 * 1024)
    };
  } catch {
    return null;
  }
}

async function runLoadTest() {
  const config = parseArgs();
  console.log(`\n======================================================`);
  console.log(` Starting Load Test: ${config.concurrency} Concurrent Connections`);
  console.log(` Duration: ${config.duration}s | Target Server: ${config.serverUrl}`);
  if (config.serverPid) console.log(` Monitoring Server PID: ${config.serverPid}`);
  console.log(` Machine Architecture: Shared 8 GB host (Server + DB + Generator)`);
  console.log(`======================================================`);

  await mongoose.connect(env.MONGODB_URI);

  // 1. Setup benchmark workspace and agent
  const benchmarkId = `bench_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const agentUser = await User.create({
    username: `benchAgent_${benchmarkId}`,
    email: `agent_${benchmarkId}@benchmark.local`,
    passwordHash: 'dummy'
  });

  const benchmarkWs = await Workspace.create({
    name: `LoadTest Workspace ${benchmarkId}`,
    publicKey: `pk_bench_${benchmarkId}`,
    joinCode: 'BENCH1',
    owner: agentUser._id
  });

  agentUser.workspace = benchmarkWs._id;
  await agentUser.save();

  const agentToken = jwt.sign({ id: agentUser._id }, env.JWT_SECRET, { expiresIn: '2h' });

  // 2. Connect Agent Socket
  console.log('Connecting Agent Socket...');
  const agentSocket = ClientIO(config.serverUrl, {
    auth: { token: agentToken },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Agent socket connection timeout')), 10000);
    agentSocket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    agentSocket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  console.log('Agent socket connected and joined workspace room.');

  // Message tracking dictionary: msgKey -> { t0 }
  const inFlightMessages = new Map();
  const latencySamples = [];
  let totalErrors = 0;
  let totalDisconnects = 0;
  let successfulConnections = 0;
  let connectionErrors = 0;

  // Agent listener for new messages
  agentSocket.on('message:new', (msg) => {
    const now = performance.now();
    const text = msg.text || '';
    if (text.startsWith('BENCH_MSG:')) {
      const parts = text.split(':');
      const msgKey = parts[1];
      if (inFlightMessages.has(msgKey)) {
        const { t0 } = inFlightMessages.get(msgKey);
        inFlightMessages.delete(msgKey);
        const latency = now - t0;
        latencySamples.push(latency);
      }
    }
  });

  // 3. Connect N Customer Sockets concurrently
  console.log(`Ramping up ${config.concurrency} customer sockets...`);
  const customerSockets = [];
  const connectionStart = performance.now();

  const connectBatchSize = 50;
  for (let i = 0; i < config.concurrency; i += connectBatchSize) {
    const batch = [];
    const end = Math.min(i + connectBatchSize, config.concurrency);
    for (let c = i; c < end; c++) {
      const visitorId = `visitor_${benchmarkId}_${c}`;
      batch.push(
        new Promise((resolve) => {
          const socket = ClientIO(config.serverUrl, {
            auth: {
              publicKey: benchmarkWs.publicKey,
              visitorId
            },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false
          });

          const timeout = setTimeout(() => {
            connectionErrors++;
            resolve(null);
          }, 15000);

          socket.on('connect', () => {
            socket.emit('customer:start', { name: `Customer ${c}` });
          });

          socket.on('customer:ready', () => {
            clearTimeout(timeout);
            successfulConnections++;
            socket.__clientId = c;
            socket.__seq = 0;
            customerSockets.push(socket);

            socket.on('disconnect', () => {
              totalDisconnects++;
            });

            socket.on('app:error', () => {
              totalErrors++;
            });

            resolve(socket);
          });

          socket.on('connect_error', () => {
            clearTimeout(timeout);
            connectionErrors++;
            resolve(null);
          });
        })
      );
    }
    await Promise.all(batch);
    // Short breather between connection batches
    await new Promise((r) => setTimeout(r, 100));
  }

  const connectionTimeMs = performance.now() - connectionStart;
  console.log(
    `Connections complete: ${successfulConnections}/${config.concurrency} connected in ${(
      connectionTimeMs / 1000
    ).toFixed(2)}s (Errors: ${connectionErrors})`
  );

  // 4. Start Server CPU and Memory Sampling
  const cpuSamples = [];
  const memorySamples = [];
  let lastCpuStats = getProcessStats(config.serverPid);
  let lastSampleTime = performance.now();

  const samplerInterval = setInterval(() => {
    if (config.serverPid) {
      const currentStats = getProcessStats(config.serverPid);
      const currentTime = performance.now();
      if (lastCpuStats && currentStats) {
        const timeDiffSec = (currentTime - lastSampleTime) / 1000;
        const cpuDiffSec = currentStats.cpuSeconds - lastCpuStats.cpuSeconds;
        // Total CPU percent across cores
        const cpuPercent = Math.max(0, (cpuDiffSec / timeDiffSec) * 100);
        cpuSamples.push(cpuPercent);
        memorySamples.push(currentStats.memoryMB);
      }
      lastCpuStats = currentStats;
      lastSampleTime = currentTime;
    }
  }, 1000);

  // 5. Message Emission Phase (Duration: config.duration seconds)
  console.log(`Beginning ${config.duration}s measured traffic phase...`);
  const testStartTime = performance.now();
  let keepSending = true;

  // Staggered periodic emitters for each connected customer socket
  customerSockets.forEach((sock, idx) => {
    const sendLoop = async () => {
      // Stagger start
      await new Promise((r) => setTimeout(r, (idx % 20) * 150));
      while (keepSending && sock.connected) {
        const msgKey = `${sock.__clientId}_${++sock.__seq}_${Date.now()}`;
        const t0 = performance.now();
        inFlightMessages.set(msgKey, { t0 });

        sock.emit('customer:message', {
          text: `BENCH_MSG:${msgKey}:Hello agent, this is a real-time load test message.`
        });

        // Sleep 3.5s to 4.0s (under 20 msg/min limit)
        const delay = 3500 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    };
    sendLoop();
  });

  // Wait for duration to elapse
  await new Promise((r) => setTimeout(r, config.duration * 1000));
  keepSending = false;

  // Grace period to allow in-flight messages to arrive
  console.log('Traffic phase complete. Waiting 2.5s grace period for in-flight messages...');
  await new Promise((r) => setTimeout(r, 2500));
  clearInterval(samplerInterval);

  const testEndTime = performance.now();
  const actualDurationSec = (testEndTime - testStartTime) / 1000;

  // 6. Metrics Computation
  const totalDelivered = latencySamples.length;
  const messagesPerSec = totalDelivered / actualDurationSec;

  const latP50 = computePercentile(latencySamples, 50);
  const latP95 = computePercentile(latencySamples, 95);
  const latP99 = computePercentile(latencySamples, 99);
  const latMin = latencySamples.length ? Math.min(...latencySamples) : 0;
  const latMax = latencySamples.length ? Math.max(...latencySamples) : 0;
  const latAvg = latencySamples.length ? latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length : 0;

  const avgCpu = cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : 0;
  const peakCpu = cpuSamples.length ? Math.max(...cpuSamples) : 0;
  const avgMem = memorySamples.length ? memorySamples.reduce((a, b) => a + b, 0) / memorySamples.length : 0;
  const peakMem = memorySamples.length ? Math.max(...memorySamples) : 0;

  console.log(`\n--- Test Results (Concurrency: ${config.concurrency}, Duration: ${actualDurationSec.toFixed(1)}s) ---`);
  console.log(`Successful Connections : ${successfulConnections} / ${config.concurrency}`);
  console.log(`Connection Errors      : ${connectionErrors}`);
  console.log(`Disconnects During Test: ${totalDisconnects}`);
  console.log(`Server Errors (app:err): ${totalErrors}`);
  console.log(`Total Messages Delivered: ${totalDelivered}`);
  console.log(`Throughput (msg/sec)   : ${messagesPerSec.toFixed(2)} msg/s`);
  console.log(`Latency p50 (Median)   : ${latP50.toFixed(2)} ms`);
  console.log(`Latency p95            : ${latP95.toFixed(2)} ms`);
  console.log(`Latency p99            : ${latP99.toFixed(2)} ms`);
  console.log(`Latency Range (min/max): ${latMin.toFixed(2)} ms / ${latMax.toFixed(2)} ms (avg: ${latAvg.toFixed(2)} ms)`);
  if (config.serverPid) {
    console.log(`Server CPU Usage       : Avg ${avgCpu.toFixed(1)}% | Peak ${peakCpu.toFixed(1)}%`);
    console.log(`Server Memory (RSS/WS) : Avg ${avgMem.toFixed(1)} MB | Peak ${peakMem.toFixed(1)} MB`);
  }

  // 7. Cleanup
  console.log('\nCleaning up connections and test database records...');
  agentSocket.disconnect();
  customerSockets.forEach((s) => s.disconnect());

  await User.deleteMany({ _id: agentUser._id });
  await Workspace.deleteMany({ _id: benchmarkWs._id });
  await Conversation.deleteMany({ workspace: benchmarkWs._id });
  // Clean messages generated in benchmark
  await Message.deleteMany({ text: { $regex: /^BENCH_MSG/ } });
  await mongoose.disconnect();

  const report = {
    testDate: new Date().toISOString(),
    config: {
      concurrency: config.concurrency,
      durationRequestedSec: config.duration,
      actualDurationSec: Number(actualDurationSec.toFixed(2)),
      serverUrl: config.serverUrl,
      serverPid: config.serverPid
    },
    metrics: {
      successfulConnections,
      connectionErrors,
      disconnects: totalDisconnects,
      serverErrors: totalErrors,
      totalDeliveredMessages: totalDelivered,
      messagesPerSecond: Number(messagesPerSec.toFixed(2)),
      latencyMs: {
        p50: Number(latP50.toFixed(2)),
        p95: Number(latP95.toFixed(2)),
        p99: Number(latP99.toFixed(2)),
        min: Number(latMin.toFixed(2)),
        max: Number(latMax.toFixed(2)),
        avg: Number(latAvg.toFixed(2)),
        sampleCount: latencySamples.length
      },
      serverResources: {
        cpuPercent: {
          avg: Number(avgCpu.toFixed(1)),
          peak: Number(peakCpu.toFixed(1)),
          samples: cpuSamples.map((v) => Number(v.toFixed(1)))
        },
        memoryMB: {
          avg: Number(avgMem.toFixed(1)),
          peak: Number(peakMem.toFixed(1)),
          samples: memorySamples.map((v) => Number(v.toFixed(1)))
        }
      }
    }
  };

  if (config.output) {
    const resultsDir = path.resolve(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
    const outPath = path.join(resultsDir, config.output);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Report written to: ${outPath}`);
  }

  return report;
}

runLoadTest().catch((err) => {
  console.error('Load test run failed:', err);
  process.exit(1);
});
