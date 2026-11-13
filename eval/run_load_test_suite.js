import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEVELS = [100, 250, 500];
const RUNS_PER_LEVEL = 3;
const DURATION_PER_RUN = 60; // 60 seconds per prompt requirement

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // not yet ready
    }
    await sleep(500);
  }
  return false;
}

function startServer(enableProfiling = false) {
  const args = enableProfiling
    ? ['--prof', 'server/src/index.js']
    : ['server/src/index.js'];

  console.log(`Starting server process (profiling=${enableProfiling}): node ${args.join(' ')}`);
  const serverProcess = spawn('node', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.resolve(__dirname, '..')
  });

  serverProcess.stdout.on('data', (d) => {
    // console.log(`[Server stdout] ${d.toString().trim()}`);
  });
  serverProcess.stderr.on('data', (d) => {
    // console.error(`[Server stderr] ${d.toString().trim()}`);
  });

  return serverProcess;
}

async function killServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) return;
  try {
    process.kill(serverProcess.pid);
  } catch {
    // ignore
  }
  await sleep(2000);
}

function computeMedian(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function runSuite() {
  console.log('===============================================================');
  console.log(' CogniDesk Step 1 & Step 2: Full Load Test & Profiling Suite');
  console.log(' Levels: 100, 250, 500 concurrent connections');
  console.log(' Duration: 60s per run | 3 runs per level');
  console.log(' Machine: Single 8 GB Windows Host (Server + DB + Generator)');
  console.log('===============================================================\n');

  const allResults = {
    testDate: new Date().toISOString(),
    environment: {
      machine: 'Single 8 GB machine shared by server, MongoDB, and load generator',
      os: 'Windows 11',
      cpu: 'Intel(R) Core(TM) i5-10300H CPU @ 2.50GHz (4 physical cores, 8 logical)',
      ram: '8.00 GB',
      node: process.version,
      mongo: 'Local MongoDB 8.3.7 instance'
    },
    levels: {}
  };

  const resultsDir = path.resolve(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  // Start normal server for levels 100 and 250
  let serverProc = startServer(false);
  const serverReady = await waitForServer('http://127.0.0.1:5000');
  if (!serverReady) {
    console.error('Failed to start server process on port 5000!');
    process.exit(1);
  }
  console.log(`Server healthy and ready (PID: ${serverProc.pid})`);

  for (const concurrency of [100, 250]) {
    allResults.levels[concurrency] = [];
    console.log(`\n======================================================`);
    console.log(` STARTING CONCURRENCY LEVEL: ${concurrency} (${RUNS_PER_LEVEL} runs of ${DURATION_PER_RUN}s)`);
    console.log(`======================================================`);

    for (let run = 1; run <= RUNS_PER_LEVEL; run++) {
      console.log(`\n>>> Level ${concurrency} - Run ${run}/${RUNS_PER_LEVEL} (${DURATION_PER_RUN}s) <<<`);
      const outputFilename = `load_test_${concurrency}_run${run}.json`;

      // Execute load test harness as child process to keep clean memory
      const harnessCmd = `node eval/load_test_harness.js --concurrency ${concurrency} --duration ${DURATION_PER_RUN} --serverPid ${serverProc.pid} --output ${outputFilename}`;
      execSync(harnessCmd, {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
      });

      const runData = JSON.parse(fs.readFileSync(path.join(resultsDir, outputFilename), 'utf-8'));
      allResults.levels[concurrency].push(runData);

      console.log(`Completed Level ${concurrency} Run ${run}. Cooldown 8s...`);
      await sleep(8000);
    }
  }

  // Restart server with profiling enabled for highest concurrency level (500)
  console.log('\nRestarting server with --prof enabled for Level 500 profiling (Step 2)...');
  await killServer(serverProc);
  await sleep(3000);

  serverProc = startServer(true);
  const profServerReady = await waitForServer('http://127.0.0.1:5000');
  if (!profServerReady) {
    console.error('Failed to start profiled server on port 5000!');
    process.exit(1);
  }
  console.log(`Profiled server healthy and ready (PID: ${serverProc.pid})`);

  allResults.levels[500] = [];
  console.log(`\n======================================================`);
  console.log(` STARTING CONCURRENCY LEVEL: 500 (${RUNS_PER_LEVEL} runs of ${DURATION_PER_RUN}s with profiling)`);
  console.log(`======================================================`);

  for (let run = 1; run <= RUNS_PER_LEVEL; run++) {
    console.log(`\n>>> Level 500 - Run ${run}/${RUNS_PER_LEVEL} (${DURATION_PER_RUN}s) <<<`);
    const outputFilename = `load_test_500_run${run}.json`;

    const harnessCmd = `node eval/load_test_harness.js --concurrency 500 --duration ${DURATION_PER_RUN} --serverPid ${serverProc.pid} --output ${outputFilename}`;
    execSync(harnessCmd, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit'
    });

    const runData = JSON.parse(fs.readFileSync(path.join(resultsDir, outputFilename), 'utf-8'));
    allResults.levels[500].push(runData);

    console.log(`Completed Level 500 Run ${run}. Cooldown 10s...`);
    await sleep(10000);
  }

  // Check stability at 500
  const runs500 = allResults.levels[500];
  const avgErrors500 = runs500.reduce((s, r) => s + r.metrics.connectionErrors + r.metrics.disconnects, 0) / runs500.length;
  console.log(`\nLevel 500 average errors/disconnects: ${avgErrors500}`);

  // Test 1000 concurrency only if stable (rule: "1000 only if stable")
  if (avgErrors500 === 0) {
    console.log('\nLevel 500 was completely stable! Attempting 1000 concurrent connections test...');
    allResults.levels[1000] = [];
    const outputFilename = `load_test_1000_run1.json`;
    try {
      const harnessCmd = `node eval/load_test_harness.js --concurrency 1000 --duration ${DURATION_PER_RUN} --serverPid ${serverProc.pid} --output ${outputFilename}`;
      execSync(harnessCmd, {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
      });
      const runData = JSON.parse(fs.readFileSync(path.join(resultsDir, outputFilename), 'utf-8'));
      allResults.levels[1000].push(runData);
    } catch (err) {
      console.warn('Level 1000 encountered degradation or threshold limit:', err.message);
    }
  } else {
    console.log('Skipping 1000 concurrency: Level 500 showed system limits on shared 8 GB machine.');
  }

  // Shut down profiled server to write isolate tick log
  console.log('\nShutting down profiled server to flush V8 isolate log...');
  await killServer(serverProc);
  await sleep(3000);

  // Step 2: Process profiling isolate log
  console.log('\nProcessing V8 profiling logs (node --prof-process)...');
  const projectRoot = path.resolve(__dirname, '..');
  const files = fs.readdirSync(projectRoot);
  const isolateFile = files.find((f) => f.startsWith('isolate-') && f.endsWith('.log'));

  let profilingSummary = 'No isolate log found';
  if (isolateFile) {
    const isolatePath = path.join(projectRoot, isolateFile);
    console.log(`Found isolate log: ${isolateFile}`);
    try {
      const profOutput = execSync(`node --prof-process "${isolatePath}"`, {
        maxBuffer: 50 * 1024 * 1024
      }).toString();

      fs.writeFileSync(path.join(resultsDir, 'profiling_raw.txt'), profOutput, 'utf-8');

      // Extract summary sections: [Summary], [C++], [JavaScript]
      const lines = profOutput.split('\n');
      const summarySection = lines.slice(0, 150).join('\n');
      profilingSummary = summarySection;
      fs.writeFileSync(path.join(resultsDir, 'profiling_summary.txt'), summarySection, 'utf-8');
      console.log('Saved profiling analysis to eval/results/profiling_summary.txt');
    } catch (err) {
      console.error('Error processing isolate log:', err.message);
    }
  }

  // Compute medians and aggregate table
  const summaryTable = [];
  for (const [level, runs] of Object.entries(allResults.levels)) {
    if (!runs || !runs.length) continue;
    const conns = runs.map((r) => r.metrics.successfulConnections);
    const connErrs = runs.map((r) => r.metrics.connectionErrors);
    const disconn = runs.map((r) => r.metrics.disconnects);
    const mps = runs.map((r) => r.metrics.messagesPerSecond);
    const p50s = runs.map((r) => r.metrics.latencyMs.p50);
    const p95s = runs.map((r) => r.metrics.latencyMs.p95);
    const p99s = runs.map((r) => r.metrics.latencyMs.p99);
    const cpus = runs.map((r) => r.metrics.serverResources.cpuPercent.avg);
    const mems = runs.map((r) => r.metrics.serverResources.memoryMB.avg);

    summaryTable.push({
      concurrency: Number(level),
      runsCount: runs.length,
      medianConnections: computeMedian(conns),
      medianConnectionErrors: computeMedian(connErrs),
      medianDisconnects: computeMedian(disconn),
      medianThroughputMsgSec: computeMedian(mps),
      medianLatencyP50Ms: computeMedian(p50s),
      medianLatencyP95Ms: computeMedian(p95s),
      medianLatencyP99Ms: computeMedian(p99s),
      medianCpuAvgPercent: computeMedian(cpus),
      medianMemoryAvgMB: computeMedian(mems)
    });
  }

  allResults.summaryTable = summaryTable;

  fs.writeFileSync(
    path.join(resultsDir, 'load_test_summary.json'),
    JSON.stringify(allResults, null, 2),
    'utf-8'
  );

  console.log('\n===============================================================');
  console.log(' LOAD TEST AGGREGATED SUMMARY TABLE');
  console.log('===============================================================');
  console.table(summaryTable);
  console.log('Saved all raw outputs to eval/results/load_test_*.json and load_test_summary.json');

  return allResults;
}

runSuite().catch((err) => {
  console.error('Suite execution failed:', err);
  process.exit(1);
});

