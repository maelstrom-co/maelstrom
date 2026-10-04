import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [statusPath, raw] = process.argv.slice(2);
const { cwd, args, timeoutMs } = JSON.parse(raw);
let expired = false;
let finished = false;
let cleanup = 'pending';
const child = spawn(args[0], args.slice(1), {
  cwd,
  env: process.env,
  detached: true,
  stdio: 'ignore',
});
const state = {
  supervisorPid: process.pid,
  pid: child.pid ?? null,
  pgid: child.pid ?? null,
};
const publish = (phase, extra = {}) => {
  const text = JSON.stringify({ ...state, phase, ...extra });
  writeFileSync(statusPath, text, { mode: 0o600 });
  appendFileSync(join(dirname(statusPath), 'processes.jsonl'), `${text}\n`, {
    mode: 0o600,
  });
};
publish('started');
function signalGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') cleanup = 'failed';
  }
}
function groupExists() {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
async function complete(code) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  signalGroup('SIGKILL');
  const until = performance.now() + 1500;
  while (groupExists() && performance.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 20));
  cleanup = groupExists() ? 'failed' : 'complete';
  publish('finished', {
    outcome: expired ? 'timeout' : code === 0 ? 'passed' : 'failed',
    cleanup,
  });
  process.exitCode = 0;
}
const deadline = setTimeout(() => {
  expired = true;
  signalGroup('SIGTERM');
  setTimeout(() => {
    signalGroup('SIGKILL');
    void complete(null);
  }, 500).unref();
}, timeoutMs);
child.once('error', () => void complete(null));
child.once('exit', (code) => void complete(code));
setTimeout(() => {
  expired = true;
  signalGroup('SIGKILL');
  void complete(null);
}, timeoutMs + 2500).unref();
