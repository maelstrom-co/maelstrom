import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit } from '../fixtures/commit.ts';
import { CONTRIBUTING_DCO_URL } from './contributing-dco-url.ts';
import { renderComment } from './render-comment.ts';
import { backtickCount } from './test-helpers/backtick-count.ts';
import { cellsOf } from './test-helpers/cells-of.ts';
import { signed } from './test-helpers/signed.ts';
import { tableRows } from './test-helpers/table-rows.ts';

describe('failBody', () => {
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

  it.each([
    ['a pipe', 'Ada | Lovelace'],
    ['a backtick', 'Ada `Lovelace`'],
    ['Markdown emphasis', 'Ada **Lovelace** _the_ [first](https://x)'],
    ['an HTML tag', 'Ada <img src="https://attacker.example/x.png">'],
    ['a backslash before a pipe', 'Ada \\| Lovelace'],
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
          'p\\|q@example.com',
          '<img src="https://attacker.example/x.png">',
        ],
      },
    ]);
    const rows = tableRows(body);
    expect(rows).toHaveLength(1);
    const cells = cellsOf(rows[0] ?? '');
    expect(cells).toHaveLength(3);
    // One code span per address, each closed by its own delimiter.
    expect(backtickCount(cells[2] ?? '')).toBe(8);
    expect(cells[2]).toContain('a\\|b@example.com');
    expect(cells[2]).toContain('p\\\\\\|q@example.com');
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
});

function contributingRemediationBlock(): string {
  const path = join(import.meta.dir, '..', '..', '..', '..', 'CONTRIBUTING.md');
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
