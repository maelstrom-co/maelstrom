export type ReleaseTarget = {
  /** Empty when dry-running a branch: there is no version to assert against. */
  version: string;
  /** npm dist-tag the publish lands under. */
  distTag: string;
  dryRun: boolean;
};

export class ReleaseTargetError extends Error {}

// nx.json's releaseTag.pattern is `v{version}`.
const TAG_PATTERN = /^v(.+)$/;

/**
 * A prerelease publishes under its own preid, never `latest`, so that a plain
 * `npm install @maelstrom-co/react` cannot resolve to one. `0.1.0-alpha.0`
 * carries preid `alpha`; a release version carries none.
 */
export function distTagForVersion(version: string): string {
  const dashIndex = version.indexOf('-');
  if (dashIndex === -1) return 'latest';
  const preid = version.slice(dashIndex + 1);
  const identifier = preid.split('.')[0];
  if (!identifier) {
    throw new ReleaseTargetError(
      `Cannot derive a dist-tag from prerelease version "${version}"`,
    );
  }
  return identifier;
}

export function versionFromTag(tag: string): string {
  const match = TAG_PATTERN.exec(tag);
  if (!match?.[1]) {
    throw new ReleaseTargetError(
      `Unrecognized release tag "${tag}" (expected vX.Y.Z)`,
    );
  }
  return match[1];
}

export type ResolveInput = {
  eventName: string;
  /** Tag name for a tag push; ignored for a manual dispatch. */
  refName: string;
  inputTag?: string;
  inputDryRun?: string;
};

export function resolveReleaseTarget(input: ResolveInput): ReleaseTarget {
  const isPush = input.eventName === 'push';
  const tag = (isPush ? input.refName : input.inputTag ?? '').trim();
  // A tag push is always a real release; only a manual dispatch can rehearse.
  const dryRun = isPush ? false : input.inputDryRun === 'true';

  if (!tag) {
    if (!dryRun) {
      throw new ReleaseTargetError(
        'A real publish needs a tag. Pass one, or set dry_run.',
      );
    }
    // Rehearsing a branch: prove the release resolves and packs, with no
    // version to assert manifests against.
    return { version: '', distTag: 'dry-run', dryRun: true };
  }

  const version = versionFromTag(tag);
  return { version, distTag: distTagForVersion(version), dryRun };
}
