import { describe, expect, it } from 'bun:test';
import { checkCommits } from './check-commits.ts';
import { commit } from './fixtures.ts';

describe('checkCommits', () => {
  it('flags a commit with no Signed-off-by trailer', () => {
    expect(checkCommits([commit()])).toEqual([
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
  });

  it('flags a sign-off matching neither the author nor the committer', () => {
    // Author and committer must differ here: with equal identities the fixture
    // cannot distinguish an author-or-committer match from an author-only one.
    const c = commit({
      authorEmail: 'ada@example.com',
      committerEmail: 'grace@example.com',
      committerName: 'Grace Hopper',
      message:
        'feat: add a thing\n\nSigned-off-by: Someone Else <other@example.com>',
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: ['other@example.com'],
      },
    ]);
  });

  it('rejects an empty sign-off address against empty commit identities', () => {
    // `git -c user.email="" commit --author="Nobody <>"` produces exactly this.
    // An empty address must never certify an empty identity.
    const c = commit({
      authorEmail: '',
      committerEmail: '',
      message: 'feat: x\n\nSigned-off-by: Attacker <>',
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [],
      },
    ]);
  });

  it('rejects a whitespace-only sign-off address against empty identities', () => {
    // Trimming must not turn a blank address into a match.
    const c = commit({
      authorEmail: '',
      committerEmail: '',
      message: 'feat: x\n\nSigned-off-by: Attacker < >',
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [],
      },
    ]);
  });

  it('parses no address out of an empty angle-bracket pair', () => {
    const c = commit({ message: 'x\n\nSigned-off-by: X <>' });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [],
      },
    ]);
  });

  it('rejects an empty sign-off address when GitHub resolved no author account', () => {
    const c = commit({
      authorLogin: null,
      authorType: null,
      authorEmail: '',
      committerEmail: '',
      message: 'feat: x\n\nSigned-off-by: Nobody <>',
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [],
      },
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

  it('exempts an author GitHub classified as a bot', () => {
    const c = commit({
      authorLogin: 'dependabot[bot]',
      authorType: 'Bot',
      authorName: 'dependabot[bot]',
      authorEmail: 'support@github.com',
      committerName: 'dependabot[bot]',
      committerEmail: 'support@github.com',
    });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'exempt', reason: 'bot-author' },
    ]);
  });

  it('exempts a bot author whose login carries no [bot] suffix', () => {
    // The login is not the signal in either direction.
    const c = commit({ authorLogin: 'renovate', authorType: 'Bot' });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'exempt', reason: 'bot-author' },
    ]);
  });

  it('does not exempt a [bot] login GitHub did not classify as a bot', () => {
    // Trust boundary. The login is whatever account GitHub resolved from the
    // commit email, so a contributor who sets `user.email` to a bot's noreply
    // address gets that login — and would otherwise walk through the gate.
    // Only `author.type` is GitHub's own classification of the account.
    const c = commit({ authorLogin: 'dependabot[bot]', authorType: null });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'violation', reason: 'missing-sign-off' },
    ]);
  });

  it('does not exempt an author type other than Bot', () => {
    // The type is compared exactly: no suffix or substring match, in contrast
    // to the login rule this replaced.
    const c = commit({ authorLogin: 'foo[bot]bar', authorType: 'User' });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'violation', reason: 'missing-sign-off' },
    ]);
  });

  it('exempts a merge commit as a merge before considering its bot author', () => {
    const c = commit({
      parentCount: 2,
      authorLogin: 'dependabot[bot]',
      authorType: 'Bot',
    });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'exempt', reason: 'merge-commit' },
    ]);
  });

  it('accepts a sign-off from an author GitHub could not resolve to an account', () => {
    // GitHub returns `author: null` for any commit whose email is not linked to
    // an account — the common case for first-time and fork contributors, which
    // is exactly the population this check gates.
    const c = commit({
      authorLogin: null,
      authorType: null,
      message:
        'feat: add a thing\n\nSigned-off-by: Ada Lovelace <ada@example.com>',
    });
    expect(checkCommits([c])).toEqual([{ commit: c, state: 'signed' }]);
  });

  it('flags an unresolved author with no trailer', () => {
    const c = commit({ authorLogin: null, authorType: null });
    expect(checkCommits([c])).toEqual([
      { commit: c, state: 'violation', reason: 'missing-sign-off' },
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

  it('accepts a CRLF commit message', () => {
    // Windows editors and web-UI round-trips produce CRLF, and `(.*)$` under
    // `/m` captures the trailing `\r` into the trailer value.
    const c = commit({
      message:
        'feat: x\r\n\r\nSigned-off-by: Ada Lovelace <ada@example.com>\r\n',
    });
    expect(checkCommits([c])).toEqual([{ commit: c, state: 'signed' }]);
  });

  it('parses a CRLF sign-off address with no trailing carriage return', () => {
    const c = commit({
      authorEmail: 'grace@example.com',
      committerEmail: 'grace@example.com',
      message:
        'feat: x\r\n\r\nSigned-off-by: Ada Lovelace <ada@example.com>\r\n',
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: ['ada@example.com'],
      },
    ]);
  });

  it('parses no address out of a CRLF trailer that carries none', () => {
    // A lone `\r` capture must not be mistaken for an address.
    const c = commit({
      message: 'feat: x\r\n\r\nSigned-off-by: Ada Lovelace\r\n',
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [],
      },
    ]);
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
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [],
      },
    ]);
  });

  it('lowercases the address inside the final angle brackets', () => {
    const c = commit({
      authorEmail: 'grace@example.com',
      committerEmail: 'grace@example.com',
      message: 'x\n\nSigned-off-by: Ada <ADA@Example.com>',
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: ['ada@example.com'],
      },
    ]);
  });

  it('collects every trailer in the message', () => {
    const c = commit({
      authorEmail: 'grace@example.com',
      committerEmail: 'grace@example.com',
      message: [
        'x',
        '',
        'Signed-off-by: One <one@example.com>',
        'Signed-off-by: Two <two@example.com>',
      ].join('\n'),
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: ['one@example.com', 'two@example.com'],
      },
    ]);
  });

  it('does not let a bare trailer prefix swallow the following line', () => {
    // `\s*` after the colon would match the newline and capture the next line
    // as the trailer value, inventing an address the commit never carried.
    const c = commit({
      message: 'Signed-off-by:\nNot A Trailer <nope@example.com>',
    });
    expect(checkCommits([c])).toEqual([
      {
        commit: c,
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [],
      },
    ]);
  });

  it('returns no violations for an all-exempt pull request', () => {
    const verdicts = checkCommits([
      commit({ parentCount: 2 }),
      commit({ authorLogin: 'renovate[bot]', authorType: 'Bot' }),
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
