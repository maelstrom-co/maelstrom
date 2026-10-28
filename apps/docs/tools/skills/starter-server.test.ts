import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('the standalone server suite runs without the documentation browser globals', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--conditions=@maelstrom-co/source',
      '--no-env-file',
      'test',
      'server.test.ts',
    ],
    {
      cwd: resolve(import.meta.dir, '../../starters/react'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    Bun.readableStreamToText(child.stdout),
    Bun.readableStreamToText(child.stderr),
  ]);
  expect(code, stdout + stderr).toBe(0);
}, 30_000);
