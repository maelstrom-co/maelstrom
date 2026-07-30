import { describe, expect, it } from 'bun:test';
import {
  type CommitData,
  checkCommits,
  signOffAddresses,
} from './check-commits.ts';

const AUTHOR = { name: 'Ada Lovelace', email: 'ada@example.com' };

function commit(overrides: Partial<CommitData> = {}): CommitData {
  return {
    sha: '0123456789abcdef0123456789abcdef01234567',
    message: 'feat: add a thing',
    authorName: AUTHOR.name,
    authorEmail: AUTHOR.email,
    committerName: AUTHOR.name,
    committerEmail: AUTHOR.email,
    authorLogin: 'ada',
    parentCount: 1,
    ...overrides,
  };
}

describe('checkCommits', () => {
  it('flags a commit with no Signed-off-by trailer', () => {
    expect(checkCommits([commit()])).toEqual([
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
  });

  it('flags a sign-off matching neither the author nor the committer', () => {
    // Author and committer deliberately differ: a fixture where they are equal
    // cannot tell this rule apart from the author-only rule it replaced.
    const c = commit({
      authorEmail: 'ada@example.com',
      committerEmail: 'grace@example.com',
      committerName: 'Grace Hopper',
      message:
        'feat: add a thing\n\nSigned-off-by: Someone Else <other@example.com>',
    });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'violation', reason: 'email-mismatch' },
    ]);
  });

  it('accepts a commit when one of several sign-offs matches the author', () => {
    const c = commit({
      message: [
        'feat: add a thing',
        '',
        'Signed-off-by: Someone Else <other@example.com>',
        'Signed-off-by: Ada Lovelace <ada@example.com>',
      ].join('\n'),
    });
    expect(checkCommits([c])).toEqual([{ commit: c, state: 'signed' }]);
  });

  it('exempts merge commits', () => {
    // Nobody authors a merge's content, so there is nothing to certify.
    const c = commit({ parentCount: 2 });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'exempt', reason: 'merge-commit' },
    ]);
  });

  it('exempts bot authors', () => {
    const c = commit({
      authorLogin: 'dependabot[bot]',
      authorName: 'dependabot[bot]',
      authorEmail: 'support@github.com',
      committerName: 'dependabot[bot]',
      committerEmail: 'support@github.com',
    });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'exempt', reason: 'bot-author' },
    ]);
  });

  it('exempts a merge commit as a merge before considering its bot author', () => {
    const c = commit({ parentCount: 2, authorLogin: 'dependabot[bot]' });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'exempt', reason: 'merge-commit' },
    ]);
  });

  it('accepts a sign-off whose name is ASCII-folded', () => {
    // Names are never compared: an ASCII-folding tool must not manufacture a
    // violation out of a correct sign-off.
    const c = commit({
      authorName: 'Chris Trześniewski',
      authorEmail: 'chris@example.com',
      committerName: 'Chris Trześniewski',
      committerEmail: 'chris@example.com',
      message:
        'fix: thing\n\nSigned-off-by: Chris Trzesniewski <chris@example.com>',
    });
    expect(checkCommits([c])).toEqual([{ commit: c, state: 'signed' }]);
  });

  it('accepts a sign-off email that differs only in case', () => {
    const c = commit({
      message:
        'feat: add a thing\n\nSigned-off-by: Ada Lovelace <ADA@Example.COM>',
    });
    expect(checkCommits([c])).toEqual([{ commit: c, state: 'signed' }]);
  });

  it('accepts a sign-off line in the middle of the body', () => {
    // This is a trailer parser, not a trailer-block parser: any line-start
    // occurrence counts, wherever it sits in the message.
    const c = commit({
      message: [
        'feat: add a thing',
        '',
        'Signed-off-by: Ada Lovelace <ada@example.com>',
        '',
        'More prose after the trailer.',
      ].join('\n'),
    });
    expect(checkCommits([c])).toEqual([{ commit: c, state: 'signed' }]);
  });

  it('accepts a sign-off matching the committer but not the author', () => {
    // probot/dco parity, and what our own hook produces when you rebase or
    // forward someone else's commit — the one case an author-only rule breaks.
    const c = commit({
      authorName: 'Grace Hopper',
      authorEmail: 'grace@example.com',
      committerName: 'Ada Lovelace',
      committerEmail: 'ada@example.com',
      message:
        'feat: add a thing\n\nSigned-off-by: Ada Lovelace <ada@example.com>',
    });
    expect(checkCommits([c])).toEqual([{ commit: c, state: 'signed' }]);
  });

  it('rejects a lowercase signed-off-by prefix', () => {
    // Case-sensitivity of the prefix is a decision, so pin it.
    const c = commit({
      message:
        'feat: add a thing\n\nsigned-off-by: Ada Lovelace <ada@example.com>',
    });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'violation', reason: 'missing-sign-off' },
    ]);
  });

  it('rejects an indented Signed-off-by line', () => {
    // A trailer is a line-start construct, so an indented one does not count.
    const c = commit({
      message:
        'feat: add a thing\n\n  Signed-off-by: Ada Lovelace <ada@example.com>',
    });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'violation', reason: 'missing-sign-off' },
    ]);
  });

  it('reports a trailer without an address as an email mismatch', () => {
    // "You signed off, but as neither the author nor the committer" is the
    // honest description of a malformed trailer.
    const c = commit({
      message: 'feat: add a thing\n\nSigned-off-by: Ada Lovelace',
    });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'violation', reason: 'email-mismatch' },
    ]);
  });

  it('returns no violations for an all-exempt pull request', () => {
    const verdicts = checkCommits([
      commit({ parentCount: 2 }),
      commit({ authorLogin: 'renovate[bot]' }),
    ]);
    expect(verdicts.every((verdict) => verdict.state === 'exempt')).toBe(true);
  });

  it('preserves input order across mixed verdicts', () => {
    const verdicts = checkCommits([
      commit({ sha: 'a'.repeat(40) }),
      commit({
        sha: 'b'.repeat(40),
        message: 'x\n\nSigned-off-by: Ada Lovelace <ada@example.com>',
      }),
      commit({ sha: 'c'.repeat(40), parentCount: 2 }),
    ]);
    expect(verdicts.map((verdict) => verdict.state)).toEqual([
      'violation',
      'signed',
      'exempt',
    ]);
  });

  it('returns an empty verdict list for an empty pull request', () => {
    expect(checkCommits([])).toEqual([]);
  });
});

describe('signOffAddresses', () => {
  it('lowercases the address inside the final angle brackets', () => {
    expect(
      signOffAddresses('x\n\nSigned-off-by: Ada <ADA@Example.com>'),
    ).toEqual(['ada@example.com']);
  });

  it('ignores a trailer that carries no address', () => {
    expect(signOffAddresses('x\n\nSigned-off-by: Ada Lovelace')).toEqual([]);
  });

  it('collects every trailer in the message', () => {
    const message = [
      'x',
      '',
      'Signed-off-by: One <one@example.com>',
      'Signed-off-by: Two <two@example.com>',
    ].join('\n');
    expect(signOffAddresses(message)).toEqual([
      'one@example.com',
      'two@example.com',
    ]);
  });

  it('does not let a bare trailer prefix swallow the following line', () => {
    // `\s*` after the colon would match the newline and capture the next line
    // as the trailer value, inventing an address the commit never carried.
    expect(
      signOffAddresses('Signed-off-by:\nNot A Trailer <nope@example.com>'),
    ).toEqual([]);
  });
});
