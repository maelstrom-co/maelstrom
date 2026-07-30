import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Verdict } from './check-commits.ts';
import { commit } from './fixtures.ts';
import {
  COMMENT_MARKER,
  CONTRIBUTING_DCO_URL,
  renderComment,
  renderLogTable,
  violationReason,
} from './render-comment.ts';

const signed: Verdict = { commit: commit(), state: 'signed' };

function tableRows(body: string): string[] {
  return body.split('\n').filter((line) => line.startsWith('| `'));
}

// Split on cell boundaries only — a `\|` inside a cell is content, not a
// boundary, which is exactly what the escaping is supposed to guarantee.
function cellsOf(row: string): string[] {
  return row.split(/(?<!\\)\|/).slice(1, -1);
}

function backtickCount(value: string): number {
  return value.split('`').length - 1;
}

describe('renderComment', () => {
  it('opens with the marker, exactly once', () => {
    // The marker is how the next run finds this comment to edit in place; a
    // second occurrence would make the find step ambiguous.
    const body = renderComment([signed]);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  });

  it('reports the signed count on a pass', () => {
    const body = renderComment([signed, signed, signed]);
    expect(body).toContain('all 3 commits');
    expect(body).toContain('✓');
  });

  it('omits the exempt parenthetical when nothing was exempt', () => {
    const body = renderComment([signed]);
    expect(body).toContain('the single commit carries');
    expect(body).not.toContain('exempt');
  });

  it('names only the exemption categories that occurred', () => {
    const body = renderComment([
      signed,
      {
        commit: commit({ parentCount: 2 }),
        state: 'exempt',
        reason: 'merge-commit',
      },
    ]);
    expect(body).toContain('(1 exempt: merge commits)');
    expect(body).not.toContain('bot authors');
  });

  it('lists both exemption categories when both occurred', () => {
    const body = renderComment([
      signed,
      {
        commit: commit({ parentCount: 2 }),
        state: 'exempt',
        reason: 'merge-commit',
      },
      {
        commit: commit({ authorLogin: 'dependabot[bot]', authorType: 'Bot' }),
        state: 'exempt',
        reason: 'bot-author',
      },
    ]);
    expect(body).toContain('(2 exempt: merge commits, bot authors)');
  });

  it('renders one table row per violation and none for the others', () => {
    const body = renderComment([
      signed,
      {
        commit: commit({ sha: 'aaaaaaa'.padEnd(40, '0') }),
        state: 'violation',
        reason: 'missing-sign-off',
      },
      {
        commit: commit({ sha: 'bbbbbbb'.padEnd(40, '0') }),
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: ['other@example.com'],
      },
    ]);
    expect(tableRows(body)).toHaveLength(2);
    expect(body).toContain('`aaaaaaa`');
    expect(body).toContain('`bbbbbbb`');
    expect(body).toContain('✗');
  });

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

  it.each([
    ['a pipe', 'Ada | Lovelace'],
    ['a backtick', 'Ada `Lovelace`'],
    ['Markdown emphasis', 'Ada **Lovelace** _the_ [first](https://x)'],
    ['an HTML tag', 'Ada <img src="https://attacker.example/x.png">'],
  ])('renders %s in an identity as inert text on a single row', (_label, authorName) => {
    const body = renderComment([
      {
        commit: commit({ authorName }),
        state: 'violation',
        reason: 'missing-sign-off',
      },
    ]);
    const rows = tableRows(body);
    expect(rows).toHaveLength(1);
    const cells = cellsOf(rows[0] ?? '');
    expect(cells).toHaveLength(3);
    // Exactly one code span: the two delimiters and nothing that could close
    // it early and let the rest of the cell render as Markdown.
    expect(backtickCount(cells[1] ?? '')).toBe(2);
    expect(cells[1]).toContain('ada@example.com');
  });

  it('renders a crafted sign-off address as inert text on a single row', () => {
    const body = renderComment([
      {
        commit: commit(),
        state: 'violation',
        reason: 'email-mismatch',
        signedOffAs: [
          'a|b@example.com',
          'x`y@example.com',
          '<img src="https://attacker.example/x.png">',
        ],
      },
    ]);
    const rows = tableRows(body);
    expect(rows).toHaveLength(1);
    const cells = cellsOf(rows[0] ?? '');
    expect(cells).toHaveLength(3);
    // One code span per address, each closed by its own delimiter.
    expect(backtickCount(cells[2] ?? '')).toBe(6);
    expect(cells[2]).toContain('a\\|b@example.com');
  });

  it('carries the remediation block and the CONTRIBUTING link on a failure', () => {
    const body = renderComment([
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
    expect(body).toContain('1 commit is');
    // The block is duplicated verbatim in CONTRIBUTING.md — a bot comment
    // cannot include a Markdown file — so pin the copy contributors actually
    // read against the copy maintainers edit.
    expect(body).toContain(contributingRemediationBlock());
    expect(body).toContain(CONTRIBUTING_DCO_URL);
  });

  it('says nothing required a sign-off when every commit was exempt', () => {
    const body = renderComment([
      {
        commit: commit({ authorLogin: 'dependabot[bot]', authorType: 'Bot' }),
        state: 'exempt',
        reason: 'bot-author',
      },
    ]);
    expect(body).toContain(
      '**DCO** ✓ no commit required a sign-off. (1 exempt: bot authors)',
    );
    expect(body).not.toContain('all 0 commits');
  });

  it('says nothing required a sign-off when there are no commits at all', () => {
    const body = renderComment([]);
    expect(body).toContain('**DCO** ✓ no commit required a sign-off.');
    expect(body).not.toContain('all 0 commits');
    expect(body).not.toContain('✗');
  });
});

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

function contributingRemediationBlock(): string {
  const path = join(import.meta.dir, '..', '..', '..', 'CONTRIBUTING.md');
  const enforcement = readFileSync(path, 'utf8').split('### Enforcement')[1];
  if (enforcement === undefined) {
    throw new Error(`no "### Enforcement" heading in ${path}`);
  }
  const block = /```bash\n[\s\S]*?\n```/.exec(enforcement)?.[0];
  if (block === undefined) {
    throw new Error(`no fenced bash block under "### Enforcement" in ${path}`);
  }
  return block;
}
