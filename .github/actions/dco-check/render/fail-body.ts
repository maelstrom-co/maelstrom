import type { Verdict } from '../policy/verdict.ts';
import type { Violation } from '../policy/violation.ts';
import { code } from './code.ts';
import { CONTRIBUTING_DCO_URL } from './contributing-dco-url.ts';
import { detail } from './detail.ts';
import { identityCell } from './identity-cell.ts';
import { row } from './row.ts';
import { shortSha } from './short-sha.ts';

export function failBody(
  verdicts: Verdict[],
  violations: Violation[],
  isFork: boolean,
): string {
  const count =
    violations.length === 1
      ? '1 commit is'
      : `${violations.length} of ${verdicts.length} commits are`;
  const listed = violations.slice(0, ROW_LIMIT);
  return [
    `**DCO** ✗ ${count} missing a matching \`Signed-off-by\` trailer.`,
    '',
    row(['Commit', 'Author', 'Reason']),
    row(['---', '---', '---']),
    ...listed.map((verdict) =>
      row([
        code(shortSha(verdict.commit)),
        identityCell(verdict.commit),
        detail(verdict),
      ]),
    ),
    '',
    ...omittedNote(violations.length - listed.length),
    ...remediation(isFork),
    '',
    'Single commit: `git commit --amend --signoff --no-edit`.',
    '',
    ...mergeNote(verdicts),
    'The sign-off email must equal either the commit author or the committer email,',
    'case-insensitively; the name is never compared. Merge commits are exempt, as are',
    'commits from a bot account on a branch in this repository — never on a fork.',
    `See [the DCO section of CONTRIBUTING.md](${CONTRIBUTING_DCO_URL}).`,
  ].join('\n');
}

// Its own paragraph, after the blank line that closes the table: GFM reads any
// non-blank line following a row as another row.
function omittedNote(omitted: number): string[] {
  if (omitted === 0) {
    return [];
  }
  const subject = omitted === 1 ? 'commit needs' : 'commits need';
  return [`…and ${omitted} more ${subject} re-signing.`, ''];
}

// The rebase names the base branch instead of counting commits back from HEAD,
// and both halves of that matter. `git rebase --signoff HEAD~N` walks the
// first-parent chain while N counts every commit in the pull request, so a
// branch that merged another one overshoots its own start and re-signs commits
// it does not own; naming the base replays exactly the set GitHub calls the
// pull request's — the commits not reachable from the base — whatever shape the
// branch has. And on a fork `origin` is the fork itself, so only `upstream/main`
// names the base there. The `git fetch` is not decoration: a remote-tracking ref
// is stale until fetched, and rebasing onto a stale one quietly does the wrong
// thing. Naming a remote that is not configured, by contrast, fails loudly and
// rewrites nothing.
function remediation(isFork: boolean): string[] {
  if (isFork) {
    return [
      'Re-sign the branch, then force-push. This pull request comes from a fork, where',
      '`origin` is your own copy — the rebase has to name the base branch here:',
      '',
      '```bash',
      'git remote add upstream https://github.com/maelstrom-co/maelstrom.git  # once, if not set',
      'git fetch upstream',
      'git rebase --signoff upstream/main   # re-sign every commit on the branch',
      'git push --force-with-lease          # rewriting history requires a force push',
      '```',
    ];
  }
  return [
    'Re-sign the branch, then force-push:',
    '',
    '```bash',
    'git fetch origin',
    'git rebase --signoff origin/main     # re-sign every commit on the branch',
    'git push --force-with-lease          # rewriting history requires a force push',
    '```',
  ];
}

function mergeNote(verdicts: Verdict[]): string[] {
  if (!verdicts.some((verdict) => verdict.commit.parentCount > 1)) {
    return [];
  }
  return [
    'This branch carries a merge commit, which the rebase flattens away: anything',
    'recorded in the merge itself — a conflict resolution, an edit staged with it —',
    'has to be made again as you go.',
    '',
  ];
}

// A pull request can carry 250 commits and GitHub rejects a comment body over
// 65,536 characters; the rows past this one are in the job log, which has no
// such limit. The remediation is the same for every row, so a contributor loses
// nothing by reading it against thirty of them.
const ROW_LIMIT = 30;
