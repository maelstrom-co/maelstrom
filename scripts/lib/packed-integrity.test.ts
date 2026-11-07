import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packedIntegrity } from './packed-integrity.ts';

test('a path replaced by a symlink after validation is never hashed', () => {
  const root = mkdtempSync(join(tmpdir(), 'maelstrom-integrity-race-'));
  const file = join(root, 'package.tgz');
  const target = join(root, 'replacement.tgz');
  writeFileSync(file, 'original bytes');
  writeFileSync(target, 'different synthetic private bytes');
  try {
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      import {packedIntegrity} from './scripts/lib/packed-integrity.ts';
      const original=fs.lstatSync;
      fs.lstatSync=(path,...options)=>{
        const stat=original(path,...options);
        if(path===process.env.INTEGRITY_RACE_FILE){
          fs.renameSync(path,path+'.original');
          fs.symlinkSync(process.env.INTEGRITY_RACE_TARGET,path);
        }
        return stat;
      };
      syncBuiltinESMExports();
      assert.throws(()=>packedIntegrity({tarballPath:process.env.INTEGRITY_RACE_FILE}),/bounded regular file/);
    `,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 5_000,
        env: {
          ...process.env,
          INTEGRITY_RACE_FILE: file,
          INTEGRITY_RACE_TARGET: target,
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { MAX_PACKED_TARBALL_BYTES } from './packed-manifest.ts';

test('checksum authority comes from the original file bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'maelstrom-packed-integrity-'));
  const tarballPath = join(root, 'package.tgz');
  try {
    const bytes = Buffer.from('original prepared bytes');
    writeFileSync(tarballPath, bytes);
    expect(packedIntegrity({ tarballPath })).toBe(
      `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    );
    writeFileSync(tarballPath, 'different bytes');
    expect(packedIntegrity({ tarballPath })).not.toBe(
      `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(['empty', 'oversized', 'directory', 'symlink'])(
  'does not read an %s tarball as checksum authority',
  (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'maelstrom-invalid-integrity-'));
    const tarballPath = join(root, 'package.tgz');
    try {
      if (kind === 'directory') mkdirSync(tarballPath);
      else if (kind === 'symlink') {
        const target = join(root, 'target.tgz');
        writeFileSync(target, 'private fixture');
        symlinkSync(target, tarballPath);
      } else {
        writeFileSync(tarballPath, '');
        if (kind === 'oversized')
          truncateSync(tarballPath, MAX_PACKED_TARBALL_BYTES + 1);
      }
      expect(() => packedIntegrity({ tarballPath })).toThrow(
        'bounded regular file',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
