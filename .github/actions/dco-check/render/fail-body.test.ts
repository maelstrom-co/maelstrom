import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit } from '../fixtures/commit.ts';
import type { Verdict } from '../policy/verdict.ts';
import { CONTRIBUTING_DCO_URL } from './contributing-dco-url.ts';
import { renderComment } from './render-comment.ts';
import { backtickCount } from './test-helpers/backtick-count.ts';
import { cellsOf } from './test-helpers/cells-of.ts';
import { signed } from './test-helpers/signed.ts';
import { tableRows } from './test-helpers/table-rows.ts';

describe('failBody', () => {
  it('renders one table row per violation and none for the others', () => {
    const body = renderComment(
      [
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
      ],
      false,
    );
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
    const body = renderComment(
      [
        {
          commit: commit({ authorName }),
          state: 'violation',
          reason: 'missing-sign-off',
        },
      ],
      false,
    );
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
    const body = renderComment(
      [
        {
          commit: commit(),
          state: 'violation',
          reason: 'email-mismatch',
          signedOffAs: [
            'a|b@example.com',
            'x`y<img src="https://attacker.example/x.png">@example.com',
            'p\\|q@example.com',
          ],
        },
      ],
      false,
    );
    const rows = tableRows(body);
    expect(rows).toHaveLength(1);
    const cells = cellsOf(rows[0] ?? '');
    expect(cells).toHaveLength(3);
    // One code span per address, each closed by its own delimiter.
    expect(backtickCount(cells[2] ?? '')).toBe(6);
    expect(cells[2]).toContain('a\\|b@example.com');
    expect(cells[2]).toContain('p\\\\\\|q@example.com');
  });

  it('caps the table and counts the commits it left out', () => {
    const body = renderComment(
      Array.from({ length: 40 }, (_, index) => missingSignOff(index)),
      false,
    );
    expect(tableRows(body)).toHaveLength(30);
    expect(body).toContain('…and 10 more commits need re-signing.');
    // The count in the opening line stays the real one: the table is what was
    // shortened, not the verdict.
    expect(body).toContain('40 of 40 commits are');
  });

  it('says commit, singular, when one row was left out', () => {
    const body = renderComment(
      Array.from({ length: 31 }, (_, index) => missingSignOff(index)),
      false,
    );
    expect(body).toContain('…and 1 more commit needs re-signing.');
  });

  it('stays inside the GitHub comment size limit at every extreme at once', () => {
    // 250 commits is the API ceiling the policy layer refuses to audit past,
    // and every string in a row is one a contributor chose.
    const filler = 'f'.repeat(2_000);
    const body = renderComment(
      Array.from({ length: 250 }, () => ({
        commit: commit({
          authorName: '\\'.repeat(2_000),
          authorEmail: `${filler}@example.com`,
          committerName: filler,
          committerEmail: `${filler}@other.example.com`,
        }),
        state: 'violation' as const,
        reason: 'email-mismatch' as const,
        signedOffAs: Array.from({ length: 20 }, () => `${filler}@x.example`),
      })),
      false,
    );
    expect(Array.from(body).length).toBeLessThan(65_536);
    // Well inside it, rather than only just: the backstop in `renderComment`
    // should never be what keeps this true.
    expect(body.length).toBeLessThan(60_000);
  });

  it('carries the fork remediation block and the CONTRIBUTING link', () => {
    const body = renderComment([missingSignOff(0)], true);
    expect(body).toContain('1 commit is');
    // Both blocks are duplicated verbatim in CONTRIBUTING.md — a bot comment
    // cannot include a Markdown file — so pin the copy contributors actually
    // read against the copy maintainers edit, and pin that the branch picked
    // the right one of the two.
    expect(body).toContain(contributingRemediationBlock(FORK_HEADING));
    expect(body).not.toContain(contributingRemediationBlock(BASE_HEADING));
    expect(body).toContain('git commit --amend --signoff --no-edit');
    expect(body).toContain(CONTRIBUTING_DCO_URL);
  });

  it('carries the base-repo remediation block and the CONTRIBUTING link', () => {
    const body = renderComment([missingSignOff(0)], false);
    expect(body).toContain('1 commit is');
    expect(body).toContain(contributingRemediationBlock(BASE_HEADING));
    expect(body).not.toContain(contributingRemediationBlock(FORK_HEADING));
    expect(body).toContain('git commit --amend --signoff --no-edit');
    expect(body).toContain(CONTRIBUTING_DCO_URL);
  });

  it('rebases a fork onto the parent repository, never onto its own origin', () => {
    // `gh repo fork` points `origin` at the fork, so `origin/main` there is the
    // contributor's own copy and rebasing onto it replays the wrong commits.
    const body = renderComment([missingSignOff(0)], true);
    expect(body).toContain('git rebase --signoff upstream/main');
    expect(body).toContain('git fetch upstream');
    expect(body).not.toContain('origin/main');
  });

  it('fetches before rebasing onto a base-repo branch', () => {
    // A remote-tracking ref is stale until fetched, and rebasing onto a stale
    // one quietly re-signs the wrong set.
    const body = renderComment([missingSignOff(0)], false);
    expect(body).toContain('git fetch origin');
    expect(body).toContain('git rebase --signoff origin/main');
    expect(body).not.toContain('upstream');
  });

  it('warns that the rebase flattens the merge commits on the branch', () => {
    const body = renderComment(
      [
        {
          commit: commit({ parentCount: 2 }),
          state: 'exempt',
          reason: 'merge-commit',
        },
        missingSignOff(0),
      ],
      false,
    );
    expect(body).toContain('merge commit');
    expect(body).toContain('flattens');
  });

  it('says nothing about merges on a branch that has none', () => {
    const body = renderComment([missingSignOff(0)], false);
    expect(body).not.toContain('flattens');
  });
});

function missingSignOff(index: number): Verdict {
  return {
    commit: commit({ sha: String(index).padStart(40, '0') }),
    state: 'violation',
    reason: 'missing-sign-off',
  };
}

function contributingRemediationBlock(heading: string): string {
  const path = join(import.meta.dir, '..', '..', '..', '..', 'CONTRIBUTING.md');
  const enforcement = readFileSync(path, 'utf8').split('### Enforcement')[1];
  if (enforcement === undefined) {
    throw new Error(`no "### Enforcement" heading in ${path}`);
  }
  const variant = enforcement.split(heading)[1];
  if (variant === undefined) {
    throw new Error(
      `no "${heading}" variant under "### Enforcement" in ${path}`,
    );
  }
  const block = /```bash\n[\s\S]*?\n```/.exec(variant)?.[0];
  if (block === undefined) {
    throw new Error(`no fenced bash block under "${heading}" in ${path}`);
  }
  return block;
}

const FORK_HEADING = '**Working from a fork:**';
const BASE_HEADING = '**Working from a branch in this repository:**';
