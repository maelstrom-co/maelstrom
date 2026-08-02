import { describe, expect, it } from 'bun:test';
import { commit } from '../fixtures/commit.ts';
import { violationReason } from './violation-reason.ts';

describe('violationReason', () => {
  it('describes a missing trailer', () => {
    expect(
      violationReason({
        commit: commit(),
        state: 'violation',
        reason: 'missing-sign-off',
      }),
    ).toBe('no Signed-off-by trailer');
  });

  it('names the offending address on a mismatch', () => {
    expect(
      violationReason({
        commit: commit(),
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: ['other@example.com'],
      }),
    ).toBe(
      'sign-off email matches neither author nor committer (signed off as `other@example.com`)',
    );
  });

  it('names every offending address, not just the first', () => {
    expect(
      violationReason({
        commit: commit(),
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: ['one@example.com', 'two@example.com'],
      }),
    ).toBe(
      'sign-off email matches neither author nor committer (signed off as `one@example.com`, `two@example.com`)',
    );
  });

  it('names the first few addresses and counts the rest', () => {
    // A commit may carry any number of trailers, so this is the one cell a
    // single row can spend the whole comment's size budget on.
    expect(
      violationReason({
        commit: commit(),
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [
          'one@example.com',
          'two@example.com',
          'three@example.com',
          'four@example.com',
          'five@example.com',
        ],
      }),
    ).toBe(
      'sign-off email matches neither author nor committer (signed off as `one@example.com`, `two@example.com`, `three@example.com`, and 2 more)',
    );
  });

  it('bounds an address long enough to fill the comment on its own', () => {
    const reason = violationReason({
      commit: commit(),
      state: 'violation',
      reason: 'email-mismatch',
      signedOffAs: [`${'a'.repeat(10_000)}@example.com`],
    });
    expect(reason.length).toBeLessThan(400);
    expect(reason).toContain('a…');
  });

  it('omits the parenthetical when the trailer carried no address', () => {
    expect(
      violationReason({
        commit: commit(),
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [],
      }),
    ).toBe('sign-off email matches neither author nor committer');
  });
});
