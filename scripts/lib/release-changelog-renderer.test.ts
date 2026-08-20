import { describe, expect, it } from 'bun:test';
import type { ChangelogChange } from 'nx/release/changelog-renderer';
import { scopeChangesToReleaseProjects } from './release-changelog-renderer.ts';

function change(shortHash: string | undefined): ChangelogChange {
  return {
    type: 'feat',
    scope: shortHash === 'mixed' ? 'demo' : '',
    description: shortHash ?? 'version plan',
    affectedProjects: '*',
    shortHash,
  };
}

const releaseProjects = [
  { name: '@maelstrom-co/react', root: 'packages/react' },
  { name: '@maelstrom-co/client', root: 'packages/client' },
];

describe('scopeChangesToReleaseProjects', () => {
  it('keeps package changes and excludes app-only changes from release notes', () => {
    const filesByCommit = new Map([
      ['package', ['packages/react/src/index.ts']],
      ['app', ['apps/demo/src/main.tsx']],
      ['mixed', ['apps/www/src/index.astro', 'packages/client/src/index.ts']],
    ]);

    const changes = scopeChangesToReleaseProjects(
      [change('package'), change('app'), change('mixed')],
      releaseProjects,
      (commit) => filesByCommit.get(commit) ?? [],
    );

    expect(changes.map(({ shortHash }) => shortHash)).toEqual([
      'package',
      'mixed',
    ]);
    // The mixed commit's original app scope must not leak into package notes.
    expect(changes.map(({ scope }) => scope)).toEqual(['react', 'client']);
  });

  it('uses path boundaries instead of matching package-root prefixes', () => {
    expect(
      scopeChangesToReleaseProjects(
        [change('similar-name')],
        [{ name: '@maelstrom-co/react', root: 'packages/react' }],
        () => ['packages/react-realtime/src/index.ts'],
      ),
    ).toEqual([]);
  });

  it('preserves the scope when a commit changes several release packages', () => {
    expect(
      scopeChangesToReleaseProjects(
        [{ ...change('several'), scope: 'realtime' }],
        releaseProjects,
        () => ['packages/react/src/index.ts', 'packages/client/src/index.ts'],
      )[0].scope,
    ).toBe('realtime');
  });

  it('keeps version-plan changes that have no backing commit', () => {
    expect(
      scopeChangesToReleaseProjects(
        [change(undefined)],
        releaseProjects,
        () => [],
      ),
    ).toHaveLength(1);
  });
});
