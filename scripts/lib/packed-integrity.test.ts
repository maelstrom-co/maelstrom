import { expect, test } from 'bun:test';
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

test.each([
  'empty',
  'oversized',
  'directory',
  'symlink',
])('does not read an %s tarball as checksum authority', (kind) => {
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
});
