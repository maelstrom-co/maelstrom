import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reports an indeterminate registry error instead of package absence', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'maelstrom-fake-npm-'));
  const npm = join(binDir, 'npm');
  writeFileSync(
    npm,
    "#!/bin/sh\nprintf 'npm error code E401\\nnpm error authentication failed\\n' >&2\nexit 1\n",
  );
  chmodSync(npm, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/verify-published.ts',
        '--version',
        '9.9.9-test.0',
        '--attempts',
        '1',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('authentication failed');
    expect(output).not.toContain('not found on');
  } finally {
    rmSync(binDir, { force: true, recursive: true });
  }
});
