/**
 * The handoff between the two halves of a release. The prepare job packs
 * tarballs from the built tree and writes this alongside them; the publish job
 * — which never installs dependencies, and so has no project graph to walk —
 * reads it to learn what to upload and under which name and version.
 */
export type PackedPackage = {
  name: string;
  version: string;
  /** Tarball filename, relative to the directory holding this manifest. */
  tarball: string;
};

export const PACKED_MANIFEST_FILENAME = 'packed.json';
