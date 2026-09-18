// Orchestrates the full local dev environment in one terminal: local
// PostgreSQL (via db:start) and the Next.js web app (dev:web).
//
// Uses `concurrently` rather than a hand-rolled process manager: reliably
// propagating Ctrl+C to a tree of child processes is genuinely fiddly
// cross-platform, and especially unreliable via a raw `child_process.spawn`
// on Windows (no real POSIX process groups/signals) — concurrently is a
// small, single-purpose, widely-used devDependency that already solves
// exactly that problem correctly, rather than us reimplementing it here.
//
// Before starting PostgreSQL, this checks whether something is already
// listening on its port, so `npm run dev` never tries to spin up a second
// instance on top of one already running (e.g. from a separate
// `npm run db:start`, or a previous `npm run dev` session).
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Must match the port in scripts/dev-db.mjs.
const POSTGRES_PORT = 5433;

function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

const postgresAlreadyRunning = await isPortInUse(POSTGRES_PORT);

const targets = [];
const names = [];
const colors = [];

if (postgresAlreadyRunning) {
  console.log(
    `[dev] PostgreSQL already running on port ${POSTGRES_PORT} — not starting another instance.`,
  );
} else {
  targets.push('db:start');
  names.push('db');
  colors.push('yellow');
}

targets.push('dev:web');
names.push('web');
colors.push('green');

const concurrentlyBin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'concurrently.cmd' : 'concurrently',
);

// Built as a single command string (rather than an args array) because all
// values here are internally-controlled constants, never user input, and
// Node warns that combining an args array with `shell: true` is unsafe for
// untrusted input.
const command = [
  `"${concurrentlyBin}"`,
  '--kill-others-on-fail',
  '--names',
  names.join(','),
  '--prefix-colors',
  colors.join(','),
  ...targets.map((target) => `npm:${target}`),
].join(' ');

const child = spawn(command, { stdio: 'inherit', shell: true });

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
