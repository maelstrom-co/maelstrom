import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKED_PACKAGE_NAMES } from './lib/packed-manifest.ts';

test('verifies every published SDK when npm 12 returns singleton field arrays', () => {
  const directory = mkdtempSync(join(tmpdir(), 'maelstrom-npm12-fields-'));
  const npm = join(directory, 'npm');
  const manifest = join(directory, 'packed.json');
  writeFileSync(npm, '#!/bin/sh\nprintf \'["9.9.9-test.0"]\\n\'\n');
  chmodSync(npm, 0o755);
  writeFileSync(
    manifest,
    JSON.stringify(
      PACKED_PACKAGE_NAMES.map((name, index) => ({
        name,
        version: '9.9.9-test.0',
        tarball: `${index}.tgz`,
      })),
    ),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/verify-published.ts',
        '--version',
        '9.9.9-test.0',
        '--manifest',
        manifest,
        '--attempts',
        '1',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      },
    );
    expect(result.status).toBe(0);
    expect(
      result.stdout.split('\n').filter((line) => line.endsWith('is live')),
    ).toHaveLength(PACKED_PACKAGE_NAMES.length);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('reports an indeterminate registry error instead of package absence', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'maelstrom-fake-npm-'));
  const npm = join(binDir, 'npm');
  const manifest = join(binDir, 'packed.json');
  writeFileSync(
    npm,
    "#!/bin/sh\nprintf 'npm error code E401\\nnpm error authentication failed\\n' >&2\nexit 1\n",
  );
  chmodSync(npm, 0o755);
  writeFileSync(
    manifest,
    JSON.stringify(
      PACKED_PACKAGE_NAMES.map((name, index) => ({
        name,
        version: '9.9.9-test.0',
        tarball: `${index}.tgz`,
      })),
    ),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/verify-published.ts',
        '--version',
        '9.9.9-test.0',
        '--manifest',
        manifest,
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
