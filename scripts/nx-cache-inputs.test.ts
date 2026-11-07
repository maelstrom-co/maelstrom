import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('docs migration tests cannot reuse cached results after their lint contract changes', async () => {
  const child = Bun.spawn(
    [
      'bunx',
      '--no-install',
      'nx',
      'show',
      'target',
      'inputs',
      '@maelstrom-co/docs:test',
      '--json',
    ],
    {
      cwd: resolve(import.meta.dir, '..'),
      env: {
        ...process.env,
        NX_DAEMON: 'false',
        NX_ISOLATE_PLUGINS: 'false',
        NX_NO_CLOUD: 'true',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr || stdout);
  const inputs = JSON.parse(stdout) as { files: string[] };
  expect(inputs.files.includes('.oxlintrc.json')).toBe(true);
}, 60_000);
