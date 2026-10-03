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

test('a timed-out trial terminates its process group rather than leaving a child alive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trial-process-'));
  try {
    const pidPath = join(root, 'child.pid');
    await expect(
      runTrialProcess(
        root,
        [
          process.execPath,
          '-e',
          'const child=Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"],{stdout:"ignore",stderr:"ignore"});require("node:fs").writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000)',
          pidPath,
        ],
        process.env,
        join(root, 'stdout'),
        join(root, 'stderr'),
        500,
      ),
    ).rejects.toThrow('timed out');
    const pid = Number(await readFile(pidPath, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
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
