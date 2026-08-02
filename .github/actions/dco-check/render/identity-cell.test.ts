import { describe, expect, it } from 'bun:test';
import { commit } from '../fixtures/commit.ts';
import type { CommitData } from '../policy/commit-data.ts';
import { renderComment } from './render-comment.ts';
import { backtickCount } from './test-helpers/backtick-count.ts';
import { cellsOf } from './test-helpers/cells-of.ts';
import { strayEscapes } from './test-helpers/stray-escapes.ts';
import { tableRows } from './test-helpers/table-rows.ts';

describe('identityCell', () => {
  it('shows the committer in the author cell only when it differs', () => {
    // "matches neither author nor committer" names two identities, so a row
    // that shows one of them reads as a bug in the check.
    const diverged = renderComment(
      [
        {
          commit: commit({
            committerName: 'Grace Hopper',
            committerEmail: 'grace@example.com',
          }),
          state: 'violation',
          reason: 'email-mismatch',
          signedOffAs: ['other@example.com'],
        },
      ],
      false,
    );
    expect(diverged).toContain('grace@example.com');
    expect(diverged).toContain('<br>committer');

    const same = renderComment(
      [{ commit: commit(), state: 'violation', reason: 'missing-sign-off' }],
      false,
    );
    expect(same).not.toContain('<br>committer');
  });

  it('bounds a name and an address that would otherwise fill the comment', () => {
    const cell = authorCell(
      commit({
        authorName: 'A'.repeat(10_000),
        authorEmail: `${'b'.repeat(10_000)}@example.com`,
      }),
    );
    expect(cell.length).toBeLessThan(500);
    // Bounded separately, so a long name cannot spend the address's budget.
    expect(cell).toContain('A…');
    expect(cell).toContain('b…');
  });

  it('truncates before escaping, so no cut can leave a live backslash', () => {
    // `escapeCell` doubles a backslash, so slicing its output can end the value
    // on a lone one — which escapes the closing backtick and lets the value out
    // of its span.
    const cell = authorCell(commit({ authorName: '\\'.repeat(10_000) }));
    expect(strayEscapes(cell)).toEqual([]);
    expect(backtickCount(cell)).toBe(2);
  });
});

function authorCell(committed: CommitData): string {
  const body = renderComment(
    [{ commit: committed, state: 'violation', reason: 'missing-sign-off' }],
    false,
  );
  return cellsOf(tableRows(body)[0] ?? '')[1] ?? '';
}
