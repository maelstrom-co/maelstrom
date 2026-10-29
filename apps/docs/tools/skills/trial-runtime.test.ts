import { expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTrialDirectory,
  credentialSandbox,
  finishTrialCleanup,
  runTrialProcess,
  trialSnapshot,
} from './trial-runtime';

test('trial evidence uses the physical directory when the temporary root has an alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trial-directory-'));
  try {
    const physical = join(root, 'physical');
    const alias = join(root, 'alias');
    await mkdir(physical);
    await symlink(physical, alias);
    const directory = await createTrialDirectory(alias);
    expect(directory).toBe(await realpath(directory));
    expect(directory.startsWith(`${await realpath(physical)}/`)).toBe(true);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const second = await createTrialDirectory(alias);
    expect(second).not.toBe(directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function terminatedLinuxProcess(stat: string): boolean {
  const state = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trimStart()
    .split(/\s+/)[0];
  return state === 'Z' || state === 'X';
}

async function childTerminated(pid: number): Promise<boolean> {
  if (process.platform === 'linux') {
    try {
      // Linux may retain an orphan's zombie PID after execution has stopped.
      return terminatedLinuxProcess(
        await readFile(`/proc/${pid}/stat`, 'utf8'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
}

test('termination checks accept zombies but reject running, sleeping, and stopped processes', () => {
  for (const state of ['Z', 'X'])
    expect(terminatedLinuxProcess(`42 (fixture (child)) ${state} 1 2 3`)).toBe(
      true,
    );
  for (const state of ['R', 'S', 'D', 'T'])
    expect(terminatedLinuxProcess(`42 (fixture (child)) ${state} 1 2 3`)).toBe(
      false,
    );
});

test.each([
  0, 750,
])('a timed-out trial stops its child from executing even when Linux has not reaped its PID (startup delay %dms)', async (startupDelayMs) => {
  const root = await mkdtemp(join(tmpdir(), 'trial-process-'));
  const readyPath = join(root, 'child.json');
  const timeoutMs = 10_000;
  let parentPid: number | undefined;
  let childPid: number | undefined;
  const started = performance.now();
  const trial = runTrialProcess(
    root,
    [
      Bun.which('node') ?? '/usr/bin/node',
      '-e',
      `setTimeout(() => {
          require('node:child_process').spawn(process.execPath, ['-e', \`
            const fs = require('node:fs');
            fs.writeFileSync(process.argv[1] + '.tmp', JSON.stringify({
              parentPid: process.ppid, childPid: process.pid
            }));
            fs.renameSync(process.argv[1] + '.tmp', process.argv[1]);
            setInterval(() => {}, 1000);
          \`, process.argv[1]], { stdio: 'ignore' });
        }, Number(process.argv[2]));
        setInterval(() => {}, 1000);`,
      readyPath,
      String(startupDelayMs),
    ],
    process.env,
    join(root, 'stdout'),
    join(root, 'stderr'),
    timeoutMs,
  ).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    // Observe the descendant executing before the real process-group deadline.
    const startupDeadline = performance.now() + 5000;
    let ready: string;
    for (;;) {
      try {
        ready = await readFile(readyPath, 'utf8');
        break;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
          performance.now() >= startupDeadline
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    const pids = JSON.parse(ready);
    for (const pid of [pids.parentPid, pids.childPid])
      expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
    parentPid = pids.parentPid;
    childPid = pids.childPid;
    expect(childPid).not.toBe(parentPid);
    expect(await childTerminated(pids.parentPid)).toBe(false);
    expect(await childTerminated(pids.childPid)).toBe(false);
    expect(performance.now() - started).toBeLessThan(timeoutMs);
    const outcome = await trial;
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).toHaveProperty(
      'message',
      expect.stringContaining('timed out'),
    );
    expect(performance.now() - started).toBeGreaterThanOrEqual(timeoutMs);
    const deadline = performance.now() + 2000;
    while (
      !(await childTerminated(pids.childPid)) &&
      performance.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await childTerminated(pids.childPid)).toBe(true);
    expect(await childTerminated(pids.parentPid)).toBe(true);
  } finally {
    try {
      for (const pid of [parentPid && -parentPid, childPid]) {
        if (!pid) continue;
        await finishTrialCleanup(pid);
      }
      await trial;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}, 25_000);

test('the snapshot records directories, link targets, and modes, not only file content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trial-snapshot-'));
  try {
    await writeFile(join(root, 'file'), 'same content');
    const before = await trialSnapshot(root);
    await mkdir(join(root, 'empty'));
    await symlink('/outside', join(root, 'link'));
    await chmod(join(root, 'file'), 0o600);
    const after = await trialSnapshot(root);
    expect(after).not.toEqual(before);
    expect(after.empty).toContain('directory');
    expect(after.link).toContain('/outside');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'darwin')(
  'credential references and their originals are read-only inside the CLI sandbox',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'trial-credentials-'));
    try {
      const original = join(root, 'original');
      const reference = join(root, 'reference');
      await writeFile(original, 'synthetic credential fixture');
      await symlink(original, reference);
      for (const target of [original, reference]) {
        const child = Bun.spawn(
          [
            '/usr/bin/sandbox-exec',
            '-p',
            credentialSandbox([original, reference]),
            '/bin/sh',
            '-c',
            'printf changed > "$1"',
            'credential-test',
            target,
          ],
          { stdout: 'pipe', stderr: 'pipe' },
        );
        const code = await child.exited;
        const stderr = await new Response(child.stderr).text();
        expect({
          code,
          stderr,
          content: await readFile(original, 'utf8'),
        }).toMatchObject({ content: 'synthetic credential fixture' });
        expect(code, stderr).not.toBe(0);
        expect(await readFile(original, 'utf8')).toBe(
          'synthetic credential fixture',
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
