import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [statusPath, raw] = process.argv.slice(2);
const { cwd, args, timeoutMs } = JSON.parse(raw);
let finished = false;
let deadline;
let child;
const state = { supervisorPid: process.pid, pgid: process.pid };
const publish = (phase, extra = {}) => {
  const text = JSON.stringify({
    ...state,
    pid: child?.pid ?? null,
    phase,
    ...extra,
  });
  writeFileSync(statusPath, text, { mode: 0o600 });
  appendFileSync(join(dirname(statusPath), 'processes.jsonl'), `${text}\n`, {
    mode: 0o600,
  });
};
function complete(outcome) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  try {
    publish('finished', { outcome });
    // The caller retains this group independently and verifies its removal.
    process.exit(0);
  } catch {
    // Publication cannot be a prerequisite for killing our own descendants.
    process.kill(-process.pid, 'SIGKILL');
  }
}
try {
  // Share the supervisor's group: its ID is known before any child or file exists.
  child = spawn(args[0], args.slice(1), {
    cwd,
    env: process.env,
    stdio: 'ignore',
  });
  child.once('error', () => complete('failed'));
  child.once('exit', (code) => complete(code === 0 ? 'passed' : 'failed'));
  deadline = setTimeout(() => complete('timeout'), timeoutMs);
  publish('started');
} catch {
  process.kill(-process.pid, 'SIGKILL');
}
