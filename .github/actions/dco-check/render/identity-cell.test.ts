import { describe, expect, it } from 'bun:test';
import { commit } from '../fixtures/commit.ts';
import { renderComment } from './render-comment.ts';

describe('identityCell', () => {
  it('shows the committer in the author cell only when it differs', () => {
    // "matches neither author nor committer" names two identities, so a row
    // that shows one of them reads as a bug in the check.
    const diverged = renderComment([
      {
        commit: commit({
          committerName: 'Grace Hopper',
          committerEmail: 'grace@example.com',
        }),
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: ['other@example.com'],
      },
    ]);
    expect(diverged).toContain('grace@example.com');
    expect(diverged).toContain('<br>committer');

    const same = renderComment([
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
    expect(same).not.toContain('<br>committer');
  });
});
