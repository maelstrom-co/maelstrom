import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [statusPath, raw] = process.argv.slice(2);
const { cwd, args, timeoutMs } = JSON.parse(raw);
let finished = false;
let timedOut = false;
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
function complete(outcome, completion = {}) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  try {
    publish('finished', { outcome, ...completion });
    // The caller retains this group independently and verifies execution stopped.
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
  child.once('exit', (code, signal) =>
    complete(
      timedOut
        ? 'timeout'
        : code === 0 && signal === null
          ? 'passed'
          : 'failed',
      {
        code,
        signal,
      },
    ),
  );
  deadline = setTimeout(() => {
    timedOut = true;
    // Reap the direct child before exiting; group verification still belongs to the caller.
    child.kill('SIGKILL');
  }, timeoutMs);
  publish('started');
} catch {
  process.kill(-process.pid, 'SIGKILL');
}
