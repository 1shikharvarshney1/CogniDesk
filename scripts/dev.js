import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const pythonCmd = isWindows ? 'python' : 'python3';

const children = [];

function startProcess(name, command, args, cwd) {
  console.log(`[dev] Starting ${name}...`);
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: isWindows,
  });

  child.on('error', (err) => {
    console.error(`[${name}] Failed to start:`, err.message);
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[${name}] Exited with code ${code}`);
    }
  });

  children.push(child);
  return child;
}

// 1. Embedding microservice
startProcess(
  'embeddings',
  pythonCmd,
  ['embedding-service/main.py'],
  rootDir
);

// 2. Server (Express + Socket.io)
startProcess(
  'server',
  npmCmd,
  ['--prefix', 'server', 'run', 'dev'],
  rootDir
);

// 3. Client (Vite)
startProcess(
  'client',
  npmCmd,
  ['--prefix', 'client', 'run', 'dev'],
  rootDir
);

function cleanup() {
  console.log('\n[dev] Shutting down child processes...');
  for (const child of children) {
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
      } else {
        child.kill('SIGINT');
      }
    } catch {
      // ignore cleanup errors
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
