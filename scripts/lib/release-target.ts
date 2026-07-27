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

// A tag name, or a workflow_dispatch input, is the least trusted thing in the
// release. Both end up on a command line and in GITHUB_OUTPUT, so constrain
// them to semver's own character set rather than trusting downstream quoting:
// no shell metacharacters, no newlines, nothing that can start a second
// output line.
const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// npm dist-tags may not look like a version and may not lead with punctuation.
const DIST_TAG_PATTERN = /^[A-Za-z][0-9A-Za-z._-]*$/;

/**
 * A prerelease publishes under its own preid, never `latest`, so that a plain
 * `npm install @maelstrom-co/react` cannot resolve to one. `0.1.0-alpha.0`
 * carries preid `alpha`; a release version carries none.
 */
export function distTagForVersion(version: string): string {
  // Build metadata is not part of the prerelease, and it may itself contain a
  // `-`. Scanning the whole string for the first `-` therefore both dragged
  // `+build` into the preid and read a stable `1.0.0+build-1` as a prerelease
  // — either way a tag SEMVER_PATTERN accepted died at derivation.
  const core = version.split('+')[0] ?? version;
  const dashIndex = core.indexOf('-');
  if (dashIndex === -1) return 'latest';
  const preid = core.slice(dashIndex + 1);
  const identifier = preid.split('.')[0];
  if (!identifier || !DIST_TAG_PATTERN.test(identifier)) {
    throw new ReleaseTargetError(
      `Cannot derive a usable dist-tag from prerelease version "${version}"`,
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
  const version = match[1];
  if (!SEMVER_PATTERN.test(version)) {
    throw new ReleaseTargetError(
      `Release tag "${tag}" does not carry a plain semver version`,
    );
  }
  return version;
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
