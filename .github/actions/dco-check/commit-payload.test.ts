import { describe, expect, it } from 'bun:test';
import { CommitPayloadError, toCommitData } from './commit-payload.ts';

// Shaped after a real `GET /repos/{o}/{r}/pulls/{n}/commits` entry, extra
// fields included: the mapping must keep working when GitHub adds more.
function entry(overrides: Record<string, unknown> = {}): unknown {
  return {
    sha: '6dcb09b5b57875f334f61aebed695e2e4193db5e',
    node_id: 'C_kwDOABPHjNoAKDZkY2IwOWI1',
    commit: {
      author: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        date: '2011-04-14T16:00:49Z',
      },
      committer: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        date: '2011-04-14T16:00:49Z',
      },
      message:
        'feat: add a thing\n\nSigned-off-by: Ada Lovelace <ada@example.com>',
      tree: {
        sha: '827efc6d56897b048c772eb4087f854f46256132',
        url: 'https://…',
      },
      url: 'https://api.github.com/repos/o/r/git/commits/6dcb09b',
      comment_count: 0,
      verification: { verified: false, reason: 'unsigned' },
    },
    url: 'https://api.github.com/repos/o/r/commits/6dcb09b',
    html_url: 'https://github.com/o/r/commit/6dcb09b',
    comments_url: 'https://api.github.com/repos/o/r/commits/6dcb09b/comments',
    author: {
      login: 'ada',
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      type: 'User',
      site_admin: false,
    },
    committer: {
      login: 'ada',
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      type: 'User',
      site_admin: false,
    },
    parents: [
      {
        sha: '553c2077f0edc3d5dc5d17262f6aa498e69d6f8e',
        url: 'https://api.github.com/repos/o/r/commits/553c207',
      },
    ],
    ...overrides,
  };
}

describe('toCommitData', () => {
  it('maps a captured commits-endpoint entry', () => {
    expect(toCommitData(entry())).toEqual({
      sha: '6dcb09b5b57875f334f61aebed695e2e4193db5e',
      message:
        'feat: add a thing\n\nSigned-off-by: Ada Lovelace <ada@example.com>',
      authorName: 'Ada Lovelace',
      authorEmail: 'ada@example.com',
      committerName: 'Ada Lovelace',
      committerEmail: 'ada@example.com',
      authorLogin: 'ada',
      authorType: 'User',
      parentCount: 1,
    });
  });

  it('carries the account type GitHub assigned the author', () => {
    // The whole bot exemption hangs off this field, so pin that it is read
    // from the account object and not from the commit identity.
    const data = toCommitData(
      entry({ author: { login: 'dependabot[bot]', type: 'Bot' } }),
    );
    expect(data.authorType).toBe('Bot');
    expect(data.authorLogin).toBe('dependabot[bot]');
  });

  it('reports no login or type when GitHub resolved no account', () => {
    // The common case for fork and first-time contributors: `author: null`.
    const data = toCommitData(entry({ author: null }));
    expect(data.authorLogin).toBeNull();
    expect(data.authorType).toBeNull();
  });

  it('treats a missing login or type as absent rather than failing', () => {
    const data = toCommitData(entry({ author: { id: 1 } }));
    expect(data.authorLogin).toBeNull();
    expect(data.authorType).toBeNull();
  });

  it('counts parents so a merge commit is detectable', () => {
    expect(
      toCommitData(entry({ parents: [{ sha: 'a' }, { sha: 'b' }] }))
        .parentCount,
    ).toBe(2);
  });

  it('counts a root commit as parentless', () => {
    expect(toCommitData(entry({ parents: [] })).parentCount).toBe(0);
  });

  it('defaults a null commit identity to empty strings', () => {
    // An empty identity must reach the policy as `''`, which is the value it
    // refuses to let an empty `<>` sign-off certify.
    const data = toCommitData(
      entry({
        commit: {
          message: 'feat: x',
          author: null,
          committer: null,
        },
      }),
    );
    expect(data.authorName).toBe('');
    expect(data.authorEmail).toBe('');
    expect(data.committerName).toBe('');
    expect(data.committerEmail).toBe('');
  });

  it('defaults an identity with no email to an empty string', () => {
    const data = toCommitData(
      entry({
        commit: {
          message: 'feat: x',
          author: { name: 'Ada Lovelace' },
          committer: { name: 'Ada Lovelace' },
        },
      }),
    );
    expect(data.authorEmail).toBe('');
    expect(data.committerEmail).toBe('');
  });

  it('rejects an entry that is not an object', () => {
    expect(() => toCommitData('nope')).toThrow(CommitPayloadError);
    expect(() => toCommitData(null)).toThrow(CommitPayloadError);
  });

  it('rejects an entry carrying no sha', () => {
    expect(() => toCommitData(entry({ sha: undefined }))).toThrow(
      /sha is not a string/,
    );
  });

  it('names the offending sha when a field is malformed', () => {
    // The thrown message is the whole diagnostic surface of a failed run, so
    // it has to say which commit could not be read.
    expect(() =>
      toCommitData(entry({ commit: { message: 42, author: null } })),
    ).toThrow(/6dcb09b5b57875f334f61aebed695e2e4193db5e.*commit\.message/);
  });

  it('rejects a missing commit object', () => {
    expect(() => toCommitData(entry({ commit: undefined }))).toThrow(
      /commit is not an object/,
    );
  });

  it('rejects a non-array parents field', () => {
    expect(() => toCommitData(entry({ parents: undefined }))).toThrow(
      /parents is not an array/,
    );
  });

  it('rejects a non-string email rather than coercing it', () => {
    // Coercion here would hand the policy a `[object Object]` identity and
    // report a mismatch as the contributor's fault.
    expect(() =>
      toCommitData(
        entry({
          commit: {
            message: 'feat: x',
            author: { name: 'Ada', email: { address: 'ada@example.com' } },
            committer: null,
          },
        }),
      ),
    ).toThrow(/commit\.author\.email is not a string/);
  });

  it('rejects a non-object author account', () => {
    expect(() => toCommitData(entry({ author: 'ada' }))).toThrow(
      /author is not an object/,
    );
  });
});
