import { describe, expect, it } from 'bun:test';
import type { ChangelogChange } from 'nx/release/changelog-renderer';
import { GithubRemoteReleaseClient } from 'nx/src/command-line/release/utils/remote-release-clients/github';
import ReleaseChangelogRenderer, {
  scopeChangesToReleaseProjects,
} from './release-changelog-renderer.ts';

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

const nacho = { name: 'Nacho Vazquez', email: 'nacho@naxo.dev' };
const attributedCommit = {
  name: nacho.name,
  email: nacho.email,
  username: 'NachoVazquez',
};

class AuthorRenderer extends ReleaseChangelogRenderer {
  readonly requests: string[] = [];

  constructor(
    changes: ChangelogChange[],
    private readonly commits: Record<string, typeof attributedCommit | null>,
  ) {
    const client = new GithubRemoteReleaseClient(
      {
        hostname: 'github.com',
        slug: 'maelstrom-co/maelstrom',
        apiBaseUrl: 'https://api.github.com',
      },
      false,
      null,
    );
    client.applyUsernameToAuthors = async (authors) => {
      for (const author of authors.values()) author.username = 'Jacarte';
    };
    super({
      changes,
      changelogEntryVersion: '0.1.0-alpha.1',
      project: null,
      entryWhenNoChanges: false,
      isVersionPlans: false,
      changelogRenderOptions: { authors: true, applyUsernameToAuthors: true },
      conventionalCommitsConfig: { useCommitScope: true, types: {} },
      remoteReleaseClient: client,
    });
    this.relevantChanges = changes;
  }

  protected override async getCommitAuthor(hash: string) {
    this.requests.push(hash);
    return this.commits[hash] ?? null;
  }

  async authors() {
    return (await this.renderAuthors()).join('\n');
  }
}

describe('release author attribution', () => {
  it('uses the account linked to a matching commit instead of an email-search result', async () => {
    const renderer = new AuthorRenderer(
      [{ ...change('verified'), authors: [nacho] }],
      { verified: attributedCommit },
    );

    const markdown = await renderer.authors();
    expect(markdown).toContain('- Nacho Vazquez @NachoVazquez');
    expect(markdown).not.toContain('@Jacarte');
  });

  it('does not assign the primary author account to a co-author', async () => {
    const renderer = new AuthorRenderer(
      [
        {
          ...change('verified'),
          authors: [nacho, { name: 'Other', email: 'other@example.com' }],
        },
      ],
      { verified: attributedCommit },
    );

    expect((await renderer.authors()).split('\n')).toContain('- Other');
    expect(renderer.requests).toEqual(['verified']);
  });

  it('keeps names when commits are unavailable, unlinked, or absent', async () => {
    const renderer = new AuthorRenderer(
      [
        { ...change('missing'), authors: [nacho] },
        {
          ...change(undefined),
          authors: [{ name: 'Other', email: 'other@example.com' }],
        },
      ],
      {},
    );

    const markdown = await renderer.authors();
    expect(markdown).toContain('- Nacho Vazquez');
    expect(markdown).not.toContain('@');
  });

  it('requires both name and email to match before assigning a handle', async () => {
    for (const mismatch of [
      { name: 'Someone else' },
      { email: 'someone@example.com' },
    ]) {
      const renderer = new AuthorRenderer(
        [{ ...change('mismatch'), authors: [nacho] }],
        { mismatch: { ...attributedCommit, ...mismatch } },
      );
      expect(await renderer.authors()).not.toContain('@');
    }
  });

  it('reuses verified attribution instead of requesting every commit by the same author', async () => {
    const renderer = new AuthorRenderer(
      ['first', 'second'].map((hash) => ({
        ...change(hash),
        authors: [nacho],
      })),
      { first: attributedCommit, second: attributedCommit },
    );
    expect(await renderer.authors()).toContain('@NachoVazquez');
    expect(renderer.requests).toEqual(['first']);
  });

  it('does not choose between conflicting accounts with the same display name', async () => {
    const otherIdentity = { ...nacho, email: 'other@example.com' };
    const renderer = new AuthorRenderer(
      [
        { ...change('first'), authors: [nacho] },
        { ...change('second'), authors: [otherIdentity] },
      ],
      {
        first: attributedCommit,
        second: { ...otherIdentity, username: 'DifferentAccount' },
      },
    );
    expect((await renderer.authors()).split('\n')).toContain('- Nacho Vazquez');
  });
});

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
