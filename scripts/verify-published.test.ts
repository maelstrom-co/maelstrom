import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKED_PACKAGE_NAMES } from './lib/packed-manifest.ts';

test('verifies each SDK tarball against its own npm 12 singleton metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'maelstrom-npm12-fields-'));
  const npm = join(directory, 'npm');
  const manifest = join(directory, 'packed.json');
  const metadata: Record<
    string,
    { version: string; 'dist.integrity': string }
  > = {};
  const packages = PACKED_PACKAGE_NAMES.map((name, index) => {
    const bytes = Buffer.from(`prepared bytes for ${name}`);
    writeFileSync(join(directory, `${index}.tgz`), bytes);
    metadata[`${name}@9.9.9-test.0`] = {
      version: '9.9.9-test.0',
      'dist.integrity': `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    };
    return { name, version: '9.9.9-test.0', tarball: `${index}.tgz` };
  });
  writeFileSync(
    npm,
    `#!${process.execPath}\nconst fields = ${JSON.stringify(metadata)};\nconst result = fields[process.argv[3]];\nif (!result) process.exit(1);\nconsole.log(JSON.stringify([result]));\n`,
  );
  chmodSync(npm, 0o755);
  writeFileSync(manifest, JSON.stringify(packages));
  try {
    const verify = () =>
      spawnSync(
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
    const result = verify();
    expect(result.status).toBe(0);
    expect(
      result.stdout.split('\n').filter((line) => line.endsWith('is live')),
    ).toHaveLength(PACKED_PACKAGE_NAMES.length);
    writeFileSync(
      join(directory, `${PACKED_PACKAGE_NAMES.length - 1}.tgz`),
      'changed after preparation',
    );
    const mismatch = verify();
    expect(mismatch.status).not.toBe(0);
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain(
      'published bytes differ',
    );
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
      PACKED_PACKAGE_NAMES.map((name, index) => {
        writeFileSync(join(binDir, `${index}.tgz`), 'verification fixture');
        return { name, version: '9.9.9-test.0', tarball: `${index}.tgz` };
      }),
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
