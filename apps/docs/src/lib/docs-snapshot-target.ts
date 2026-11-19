const RELEASE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Where a release's docs go: a version folder, or nowhere for a prerelease. */
export type SnapshotTarget =
  | { kind: 'folder'; release: string; folder: string }
  | { kind: 'prerelease'; release: string };

/**
 * Map a release version to its docs folder: one folder per minor before 1.0
 * (`0.3.1` goes to `0.3`), one per major from 1.0 (`1.4.2` goes to `1`).
 * Prereleases get no folder, so they never become the default version.
 */
export function snapshotTarget(release: string): SnapshotTarget {
  const match = RELEASE.exec(release);
  if (!match) {
    throw new Error(
      `Expected a semver release like 0.3.0 or v1.2.0, got "${release}".`,
    );
  }
  const [, major, minor, , prerelease] = match;
  const version = release.replace(/^v/, '');
  if (prerelease) return { kind: 'prerelease', release: version };
  const folder = major === '0' ? `0.${minor}` : `${major}`;
  return { kind: 'folder', release: version, folder };
}

export interface SnapshotSelector {
  branch?: string;
  folders?: string[];
}

export function assertFixtureMatchesSelector(
  version: string,
  config: SnapshotSelector,
): string {
  const target = snapshotTarget(version);
  if (
    target.kind !== 'folder' ||
    config.branch !== 'main' ||
    config.folders?.length !== 1 ||
    config.folders[0] !== 'apps/docs/src/content/docs/' + target.folder
  ) {
    throw new Error(
      'The published-example fixture must target the selected frozen Context7 release line. Update its manifest and lockfile together.',
    );
  }
  return target.folder;
}
