// `npm run dev` — runs the engine compiler, the API server and the Angular
// dev server together with prefixed, coloured output. Uses only Node
// built-ins (no `concurrently`). Ctrl+C stops everything.
//
// Needs Postgres running: `npm run db:up`.

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// The server and client import the engine's compiled output, so build it once
// before starting anything that depends on it.
const first = spawnSync(npm, ['run', 'build', '-w', '@subterfuge/engine'], { stdio: 'inherit' });
if (first.status !== 0) process.exit(first.status ?? 1);

const tasks = [
  { name: 'engine', color: 35, args: ['run', 'dev', '-w', '@subterfuge/engine'] },
  { name: 'server', color: 36, args: ['run', 'dev', '-w', '@subterfuge/server'] },
  { name: 'client', color: 33, args: ['run', 'dev', '-w', '@subterfuge/client'] },
];

const children = tasks.map(({ name, color, args }) => {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => process.stdout.write(prefix + line + '\n'));
  }
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
