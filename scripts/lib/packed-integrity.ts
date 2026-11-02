import { createHash } from 'node:crypto';
import { readBoundedFile } from './bounded-file.ts';
import { MAX_PACKED_TARBALL_BYTES } from './packed-manifest.ts';

/** Fingerprints the original tarball without following links or reading unbounded files. */
export function packedIntegrity(pkg: { tarballPath: string }): string {
  return `sha512-${createHash('sha512').update(readBoundedFile(pkg.tarballPath, MAX_PACKED_TARBALL_BYTES)).digest('base64')}`;
}
