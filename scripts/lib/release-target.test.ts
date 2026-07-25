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

  it('carries build metadata into the tag rather than guessing', () => {
    // `-` starts the prerelease segment; anything after it is the preid.
    expect(distTagForVersion('1.0.0-next')).toBe('next');
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
