import { describe, expect, it } from 'bun:test';
import { commit } from '../fixtures/commit.ts';
import { renderLogTable } from './render-log-table.ts';
import { backtickCount } from './test-helpers/backtick-count.ts';
import { cellsOf } from './test-helpers/cells-of.ts';
import { signed } from './test-helpers/signed.ts';
import { tableRows } from './test-helpers/table-rows.ts';

describe('renderLogTable', () => {
  it('lists every commit with its verdict, not just the violations', () => {
    const table = renderLogTable([
      signed,
      {
        commit: commit({ parentCount: 2 }),
        state: 'exempt',
        reason: 'merge-commit',
      },
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
    const rows = tableRows(table);
    expect(rows).toHaveLength(3);
    expect(table).toContain('signed');
    expect(table).toContain('exempt');
    expect(table).toContain('violation');
  });

  it('labels each exempt reason distinctly', () => {
    const table = renderLogTable([
      {
        commit: commit({ parentCount: 2 }),
        state: 'exempt',
        reason: 'merge-commit',
      },
      {
        commit: commit({ authorType: 'Bot' }),
        state: 'exempt',
        reason: 'bot-author',
      },
    ]);
    expect(table).toContain('merge commit ');
    expect(table).toContain('bot author ');
  });

  it('reuses the comment wording for violations so the surfaces cannot drift', () => {
    const table = renderLogTable([
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
    expect(table).toContain('no Signed-off-by trailer');
  });

  it('escapes an identity that would otherwise break the table', () => {
    const table = renderLogTable([
      {
        commit: commit({ authorName: 'Ada | `Lovelace`' }),
        state: 'violation',
        reason: 'missing-sign-off',
      },
    ]);
    const cells = cellsOf(tableRows(table)[0] ?? '');
    expect(cells).toHaveLength(4);
    expect(backtickCount(cells[1] ?? '')).toBe(2);
  });
});
