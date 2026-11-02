import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { MAX_PACKED_TARBALL_BYTES } from './packed-manifest.ts';

/** Fingerprints the original tarball without following links or reading unbounded files. */
export function packedIntegrity(pkg: { tarballPath: string }): string {
  const stat = lstatSync(pkg.tarballPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size === 0 ||
    stat.size > MAX_PACKED_TARBALL_BYTES
  )
    throw new Error('Tarball checksum requires a bounded regular file');
  return `sha512-${createHash('sha512').update(readFileSync(pkg.tarballPath)).digest('base64')}`;
}
