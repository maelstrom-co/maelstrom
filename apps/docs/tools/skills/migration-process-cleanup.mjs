import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pgid = Number(process.argv[2]);
if (!Number.isSafeInteger(pgid) || pgid < 2) process.exit(2);
const membership = () => {
  try {
    process.kill(-pgid, 0);
    return 'present';
  } catch (error) {
    return error.code === 'ESRCH' ? 'absent' : 'unknown';
  }
};

function zombieMembers(timeout) {
  if (process.platform !== 'linux' || timeout <= 0) return null;
  try {
    // Hidden procfs members cannot establish that the whole group has stopped.
    const mounts = readFileSync('/proc/mounts', 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split(' '))
      .filter((fields) => fields[1] === '/proc');
    if (
      mounts.length !== 1 ||
      mounts[0][2] !== 'proc' ||
      mounts[0][3]
        .split(',')
        .some(
          (option) =>
            /^hidepid=/.test(option) && !/^hidepid=(0|off)$/.test(option),
        )
    )
      return null;
    // A detached supervisor leads both the retained group and its session.
    // Reject other groups in that session rather than broadening the claim.
    // A zombie leader can still have live threads, so inspect every thread.
    const result = spawnSync(
      '/bin/ps',
      ['-L', '-s', String(pgid), '-o', 'pid=,pgid=,state='],
      {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
        timeout: Math.max(1, Math.floor(timeout)),
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
      },
    );
    if (result.error || result.status !== 0 || result.stderr.trim())
      return null;
    const members = new Set();
    for (const line of result.stdout.trim().split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+Z\s*$/.exec(line);
      if (!match) return null;
      const pid = Number(match[1]);
      if (
        !Number.isSafeInteger(pid) ||
        pid < 1 ||
        Number(match[2]) !== pgid ||
        members.has(pid)
      )
        return null;
      members.add(pid);
    }
    return [...members].sort((a, b) => a - b).join(',') || null;
  } catch {
    return null;
  }
}

try {
  process.kill(-pgid, 'SIGKILL');
} catch (error) {
  if (error.code !== 'ESRCH') process.exit(2);
}
const until = performance.now() + 1500;
let previous = null;
while (performance.now() < until) {
  const state = membership();
  if (state === 'absent') process.exit(0);
  const zombies =
    state === 'present' ? zombieMembers(until - performance.now()) : null;
  // Two matching snapshots exclude a fork racing the first enumeration.
  if (zombies !== null && zombies === previous) process.exit(0);
  previous = zombies;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
process.exit(membership() === 'absent' ? 0 : 2);
