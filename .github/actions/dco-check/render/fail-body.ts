import type { Verdict } from '../policy/verdict.ts';
import type { Violation } from '../policy/violation.ts';
import { code } from './code.ts';
import { CONTRIBUTING_DCO_URL } from './contributing-dco-url.ts';
import { detail } from './detail.ts';
import { identityCell } from './identity-cell.ts';
import { row } from './row.ts';
import { shortSha } from './short-sha.ts';

export function failBody(verdicts: Verdict[], violations: Violation[]): string {
  const count =
    violations.length === 1
      ? '1 commit is'
      : `${violations.length} of ${verdicts.length} commits are`;
  return [
    `**DCO** ✗ ${count} missing a matching \`Signed-off-by\` trailer.`,
    '',
    row(['Commit', 'Author', 'Reason']),
    row(['---', '---', '---']),
    ...violations.map((verdict) =>
      row([
        code(shortSha(verdict.commit)),
        identityCell(verdict.commit),
        detail(verdict),
      ]),
    ),
    '',
    'Re-sign the branch, then force-push:',
    '',
    '```bash',
    'git rebase --signoff origin/main     # re-sign every commit on the branch',
    'git push --force-with-lease          # rewriting history requires a force push',
    '# single commit: git commit --amend --signoff --no-edit',
    '```',
    '',
    'The sign-off email must equal either the commit author or the committer email,',
    'case-insensitively; the name is never compared. Merge commits are exempt, as are',
    'commits from a bot account on a branch in this repository — never on a fork.',
    `See [the DCO section of CONTRIBUTING.md](${CONTRIBUTING_DCO_URL}).`,
  ].join('\n');
}
