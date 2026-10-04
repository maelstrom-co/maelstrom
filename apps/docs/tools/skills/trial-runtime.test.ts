import { expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  credentialSandbox,
  runTrialProcess,
  trialSnapshot,
} from './trial-runtime';

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

test('a timed-out trial stops its child from executing even when Linux has not reaped its PID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trial-process-'));
  try {
    const pidPath = join(root, 'child.pid');
    await expect(
      runTrialProcess(
        root,
        [
          Bun.which('node') ?? '/usr/bin/node',
          '-e',
          'const child=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});require("node:fs").writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000)',
          pidPath,
        ],
        process.env,
        join(root, 'stdout'),
        join(root, 'stderr'),
        500,
      ),
    ).rejects.toThrow('timed out');
    const pid = Number(await readFile(pidPath, 'utf8'));
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    const deadline = Date.now() + 2000;
    while (!(await childTerminated(pid)) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await childTerminated(pid)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
