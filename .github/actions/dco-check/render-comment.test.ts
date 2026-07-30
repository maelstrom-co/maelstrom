import { describe, expect, it } from 'bun:test';
import type { CommitData, Verdict } from './check-commits.ts';
import {
  COMMENT_MARKER,
  CONTRIBUTING_DCO_URL,
  renderComment,
  renderLogTable,
  violationReason,
} from './render-comment.ts';

function commit(overrides: Partial<CommitData> = {}): CommitData {
  return {
    sha: 'abc1234def5678abc1234def5678abc1234def56',
    message: 'feat: add a thing',
    authorName: 'Ada Lovelace',
    authorEmail: 'ada@example.com',
    committerName: 'Ada Lovelace',
    committerEmail: 'ada@example.com',
    authorLogin: 'ada',
    parentCount: 1,
    ...overrides,
  };
}

const signed: Verdict = { commit: commit(), state: 'signed' };

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
    expect(renderComment([signed])).not.toContain('exempt');
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
        commit: commit({ authorLogin: 'dependabot[bot]' }),
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
      },
    ]);
    const rows = body.split('\n').filter((line) => line.startsWith('| `'));
    expect(rows).toHaveLength(2);
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
          message: 'x\n\nSigned-off-by: Someone <other@example.com>',
        }),
        state: 'violation',
        reason: 'email-mismatch',
      },
    ]);
    expect(diverged).toContain('grace@example.com');
    expect(diverged).toContain('<br>committer');

    const same = renderComment([
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
    expect(same).not.toContain('<br>committer');
  });

  it('escapes a pipe in an identity so it cannot break the table', () => {
    const body = renderComment([
      {
        commit: commit({ authorName: 'Ada | Lovelace' }),
        state: 'violation',
        reason: 'missing-sign-off',
      },
    ]);
    expect(body).toContain('Ada \\| Lovelace');
  });

  it('carries the remediation block and the CONTRIBUTING link on a failure', () => {
    const body = renderComment([
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
    expect(body).toContain('git rebase --signoff origin/main');
    expect(body).toContain('git push --force-with-lease');
    expect(body).toContain('git commit --amend --signoff --no-edit');
    expect(body).toContain(CONTRIBUTING_DCO_URL);
  });

  it('reports an empty pull request as a pass', () => {
    const body = renderComment([]);
    expect(body).toContain('✓');
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
        commit: commit({
          message: 'x\n\nSigned-off-by: Someone <other@example.com>',
        }),
        state: 'violation',
        reason: 'email-mismatch',
      }),
    ).toBe(
      'sign-off email matches neither author nor committer (signed off as <other@example.com>)',
    );
  });

  it('omits the parenthetical when the trailer carried no address', () => {
    expect(
      violationReason({
        commit: commit({ message: 'x\n\nSigned-off-by: Someone' }),
        state: 'violation',
        reason: 'email-mismatch',
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
    const rows = table.split('\n').filter((line) => line.startsWith('| `'));
    expect(rows).toHaveLength(3);
    expect(table).toContain('signed');
    expect(table).toContain('exempt');
    expect(table).toContain('violation');
  });

  it('reuses the comment wording for violations so the surfaces cannot drift', () => {
    const table = renderLogTable([
      { commit: commit(), state: 'violation', reason: 'missing-sign-off' },
    ]);
    expect(table).toContain('no Signed-off-by trailer');
  });
});
