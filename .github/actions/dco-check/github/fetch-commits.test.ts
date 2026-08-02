import { describe, expect, it } from 'bun:test';
import type { Config } from '../config/config.ts';
import { commit } from '../fixtures/commit.ts';
import { CommitPayloadError } from './commit-payload-error.ts';
import { createFetchCommits } from './fetch-commits.ts';
import type { Pages } from './pages.ts';

const CONFIG: Config = {
  token: 'ghs_token',
  repository: 'maelstrom-co/maelstrom',
  prNumber: '7',
  headSha: '0123456789abcdef0123456789abcdef01234567',
  isFork: false,
};
const COMMITS_URL =
  'https://api.github.com/repos/maelstrom-co/maelstrom/pulls/7/commits';

describe('fetchCommits', () => {
  it('maps a REST commit entry onto the policy shape', async () => {
    const fetchCommits = createFetchCommits(pagesOf([[entry()]]));
    expect(await fetchCommits(CONFIG)).toEqual([commit()]);
  });

  it('reads the pull-request commits endpoint', async () => {
    const requested: Array<[string, string, number]> = [];
    const fetchCommits = createFetchCommits(
      async function* (token, url, pageLimit) {
        requested.push([token, url, pageLimit]);
        yield [entry()];
      },
    );
    await fetchCommits(CONFIG);
    expect(requested).toEqual([[CONFIG.token, COMMITS_URL, 5]]);
  });

  it('accumulates every page in order', async () => {
    const fetchCommits = createFetchCommits(
      pagesOf([
        [entry({ sha: 'a'.repeat(40) }), entry({ sha: 'b'.repeat(40) })],
        [entry({ sha: 'c'.repeat(40) })],
      ]),
    );
    const commits = await fetchCommits(CONFIG);
    expect(commits.map((c) => c.sha)).toEqual([
      'a'.repeat(40),
      'b'.repeat(40),
      'c'.repeat(40),
    ]);
  });

  it('returns nothing for a pull request with no commits', async () => {
    // Not an error here: refusing to pass a check that audited nothing is a
    // policy decision, made once, further up.
    const fetchCommits = createFetchCommits(pagesOf([[]]));
    expect(await fetchCommits(CONFIG)).toEqual([]);
  });

  it('lets a malformed entry propagate', async () => {
    const fetchCommits = createFetchCommits(pagesOf([[{ sha: 42 }]]));
    await expect(fetchCommits(CONFIG)).rejects.toThrow(CommitPayloadError);
  });
});

function pagesOf(payloads: unknown[][]): Pages {
  return async function* () {
    yield* payloads;
  };
}

// Shaped after a real `GET /repos/{o}/{r}/pulls/{n}/commits` entry, trimmed to
// the fields the mapping reads. Its defaults are the ones `commit()` produces,
// so the two can be compared directly.
function entry(overrides: Record<string, unknown> = {}): unknown {
  return {
    sha: '0123456789abcdef0123456789abcdef01234567',
    commit: {
      message: 'feat: add a thing',
      author: { name: 'Ada Lovelace', email: 'ada@example.com' },
      committer: { name: 'Ada Lovelace', email: 'ada@example.com' },
    },
    author: { login: 'ada', type: 'User' },
    parents: [{ sha: 'fedcba9876543210fedcba9876543210fedcba98' }],
    ...overrides,
  };
}
