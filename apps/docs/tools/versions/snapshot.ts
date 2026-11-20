import { cp, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { DEV_VERSION, isVersionFolder } from '../../src/lib/docs-versions';

const docsRoot = join(import.meta.dir, '../../src/content/docs');

/**
 * The folder a release lands in: one per minor before 1.0, one per major
 * after. Prereleases get no folder.
 */
export function versionFolder(release: string): string {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(release);
  if (!match) {
    throw new Error(
      `Expected a release version like 0.3.0 or 1.2.0, got "${release}". Prereleases are not snapshotted.`,
    );
  }
  const [, major, minor] = match;
  const folder = major === '0' ? `${major}.${minor}` : `${major}`;
  if (!isVersionFolder(folder) || folder === DEV_VERSION) {
    throw new Error(`"${folder}" is not a version folder name.`);
  }
  return folder;
}

/**
 * Replace a version folder with a copy of the dev docs. Generated API
 * reference pages are left out because they are rebuilt from source.
 */
export async function snapshotDocs(
  release: string,
  root = docsRoot,
): Promise<string> {
  const folder = versionFolder(release);
  const source = join(root, DEV_VERSION);
  const destination = join(root, folder);
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, {
    recursive: true,
    filter: (path) => {
      const [first] = relative(source, path).split(sep);
      return first !== 'reference';
    },
  });
  return destination;
}

if (import.meta.main) {
  const release = process.argv[2];
  if (!release) {
    console.error('Usage: bun tools/versions/snapshot.ts <release version>');
    process.exit(1);
  }
  const destination = await snapshotDocs(release);
  console.log(
    `Copied ${DEV_VERSION} docs into ${relative(process.cwd(), destination)}`,
  );
}
