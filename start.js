#!/usr/bin/env node
/**
 * start.js — unified launcher for Lectomate
 * Runs both the backend (server/simple-server.js) and frontend (vite dev)
 * in a single terminal with color-coded, prefixed output.
 *
 * Usage:  node start.js
 * Stop:   Ctrl+C  (kills both processes cleanly)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ── Paths ────────────────────────────────────────────────────────────────────
const ROOT = __dirname;
const SERVER_DIR = path.join(ROOT, 'server');

// ── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  // Backend  → cyan
  be:     '\x1b[36m',
  // Frontend → magenta
  fe:     '\x1b[35m',
  // System   → yellow
  sys:    '\x1b[33m',
  // Success  → green
  ok:     '\x1b[32m',
  // Error    → red
  err:    '\x1b[31m',
};

const tag = (label, colour) => `${colour}${C.bold}[${label}]${C.reset} `;
const BE  = tag('backend ', C.be);
const FE  = tag('frontend', C.fe);
const SYS = tag('launcher', C.sys);

function log(prefix, line) {
  process.stdout.write(`${prefix}${line}\n`);
}

// ── Pre-flight checks ─────────────────────────────────────────────────────────
function preflight() {
  // 1. server/.env must exist
  const serverEnv = path.join(SERVER_DIR, '.env');
  if (!fs.existsSync(serverEnv)) {
    log(SYS, `${C.err}ERROR: server/.env not found.${C.reset}`);
    log(SYS, `       Copy server/.env.example to server/.env and fill in your values.`);
    log(SYS, `       At minimum you need: MONGODB_URI, JWT_SECRET, GEMINI_API_KEY`);
    process.exit(1);
  }

  // 2. root node_modules must exist
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    log(SYS, `${C.err}ERROR: root node_modules missing.${C.reset} Run: npm install`);
    process.exit(1);
  }

  // 3. server node_modules must exist
  if (!fs.existsSync(path.join(SERVER_DIR, 'node_modules'))) {
    log(SYS, `${C.err}ERROR: server/node_modules missing.${C.reset} Run: cd server && npm install`);
    process.exit(1);
  }
}

// ── Wait for backend health endpoint ─────────────────────────────────────────
function waitForBackend(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const attempt = () => {
      const req = http.get(`http://localhost:${port}/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        // non-200 still means the server is up — proceed
        return resolve();
      });
      req.on('error', () => {
        if (Date.now() >= deadline) return reject(new Error('Backend timed out'));
        setTimeout(attempt, 800);
      });
      req.setTimeout(1500, () => { req.destroy(); });
    };
    attempt();
  });
}

// ── Spawn helper ─────────────────────────────────────────────────────────────
function spawnProcess(label, colour, command, args, cwd, env = {}) {
  const prefix = tag(label, colour);
  const child = spawn(command, args, {
    cwd,
    env:   { ...process.env, ...env },
    shell: true,
    // Do NOT inherit stdio — we pipe so we can prefix every line
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const pipe = (stream, isErr) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();           // keep incomplete last line
      for (const line of lines) {
        if (line.trim()) log(prefix, isErr ? `${C.err}${line}${C.reset}` : line);
      }
    });
    stream.on('end', () => {
      if (buf.trim()) log(prefix, buf);
    });
  };

  pipe(child.stdout, false);
  pipe(child.stderr, true);

  child.on('error', (err) => {
    log(prefix, `${C.err}spawn error: ${err.message}${C.reset}`);
  });

  return child;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const children = [];
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(SYS, `${C.sys}${signal} received — stopping all processes…${C.reset}`);
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit',    () => { if (!shuttingDown) shutdown('exit'); });

// ── Read backend port from server/.env ───────────────────────────────────────
function readBackendPort() {
  try {
    const env = fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8');
    const match = env.match(/^PORT\s*=\s*(\d+)/m);
    return match ? parseInt(match[1], 10) : 3001;
  } catch {
    return 3001;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.clear();
  log(SYS, `${C.bold}${C.ok}╔═══════════════════════════════════╗${C.reset}`);
  log(SYS, `${C.bold}${C.ok}║   Lectomate — unified launcher     ║${C.reset}`);
  log(SYS, `${C.bold}${C.ok}╚═══════════════════════════════════╝${C.reset}`);
  log(SYS, '');

  preflight();

  const backendPort = readBackendPort();

  // ── 1. Start backend ──────────────────────────────────────────────────────
  log(SYS, `${C.sys}Starting backend on port ${backendPort}…${C.reset}`);
  const backend = spawnProcess(
    'backend ',
    C.be,
    'node',
    ['simple-server.js'],
    SERVER_DIR,
    { NODE_ENV: 'development' }
  );
  children.push(backend);

  backend.on('exit', (code) => {
    if (!shuttingDown) {
      log(SYS, `${C.err}Backend exited with code ${code}. Stopping frontend…${C.reset}`);
      shutdown('backend-exit');
    }
  });

  // ── 2. Wait until backend is healthy ─────────────────────────────────────
  log(SYS, `${C.sys}Waiting for backend to be ready…${C.reset}`);
  try {
    await waitForBackend(backendPort, 30000);
    log(SYS, `${C.ok}Backend is ready ✓${C.reset}`);
  } catch {
    log(SYS, `${C.err}Backend did not become ready in time. Check the logs above.${C.reset}`);
    shutdown('backend-timeout');
    return;
  }

  // ── 3. Start frontend ─────────────────────────────────────────────────────
  log(SYS, `${C.sys}Starting frontend (Vite)…${C.reset}`);
  const frontend = spawnProcess(
    'frontend',
    C.fe,
    'npm',
    ['run', 'dev'],
    ROOT,
    { VITE_API_URL: '' }   // empty → defaults to http://localhost:3001 inside api.ts
  );
  children.push(frontend);

  frontend.on('exit', (code) => {
    if (!shuttingDown) {
      log(SYS, `${C.err}Frontend exited with code ${code}. Stopping backend…${C.reset}`);
      shutdown('frontend-exit');
    }
  });

  log(SYS, '');
  log(SYS, `${C.bold}Both services started. Press ${C.ok}Ctrl+C${C.reset}${C.bold} to stop.${C.reset}`);
  log(SYS, `${C.dim}  Backend  → http://localhost:${backendPort}${C.reset}`);
  log(SYS, `${C.dim}  Frontend → http://localhost:5173${C.reset}`);
  log(SYS, '');
})();
