import {
  type CommitData,
  signOffAddresses,
  type Verdict,
} from './check-commits.ts';

export const COMMENT_MARKER = '<!-- dco-check -->';

export const CONTRIBUTING_DCO_URL =
  'https://github.com/maelstrom-co/maelstrom/blob/main/CONTRIBUTING.md#developer-certificate-of-origin-dco';

export function renderComment(verdicts: Verdict[]): string {
  const violations = verdicts.filter(
    (verdict) => verdict.state === 'violation',
  );
  const body =
    violations.length === 0
      ? passBody(verdicts)
      : failBody(verdicts, violations);
  return `${COMMENT_MARKER}\n\n${body}\n`;
}

export function renderLogTable(verdicts: Verdict[]): string {
  const rows = verdicts.map(
    (verdict) =>
      `| \`${shortSha(verdict.commit)}\` | ${identityCell(verdict.commit)} | ${verdict.state} | ${detail(verdict)} |`,
  );
  return [
    '| Commit | Author | Verdict | Detail |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

export function violationReason(
  verdict: Verdict & { state: 'violation' },
): string {
  if (verdict.reason === 'missing-sign-off') {
    return 'no Signed-off-by trailer';
  }
  const [address] = signOffAddresses(verdict.commit.message);
  const suffix = address === undefined ? '' : ` (signed off as <${address}>)`;
  return `sign-off email matches neither author nor committer${suffix}`;
}

export function shortSha(commit: CommitData): string {
  return commit.sha.slice(0, 7);
}

function passBody(verdicts: Verdict[]): string {
  const signed = verdicts.filter(
    (verdict) => verdict.state === 'signed',
  ).length;
  const subject =
    signed === 1 ? 'the single commit carries' : `all ${signed} commits carry`;
  return `**DCO** ✓ ${subject} a matching \`Signed-off-by\` trailer.${exemptNote(verdicts)}`;
}

function exemptNote(verdicts: Verdict[]): string {
  const exempt = verdicts.filter((verdict) => verdict.state === 'exempt');
  if (exempt.length === 0) {
    return '';
  }
  const categories = ['merge-commit', 'bot-author']
    .filter((reason) => exempt.some((verdict) => verdict.reason === reason))
    .map((reason) =>
      reason === 'merge-commit' ? 'merge commits' : 'bot authors',
    );
  return ` (${exempt.length} exempt: ${categories.join(', ')})`;
}

function failBody(verdicts: Verdict[], violations: Verdict[]): string {
  const count =
    violations.length === 1
      ? '1 commit is'
      : `${violations.length} of ${verdicts.length} commits are`;
  const rows = violations.map(
    (verdict) =>
      `| \`${shortSha(verdict.commit)}\` | ${identityCell(verdict.commit)} | ${detail(verdict)} |`,
  );
  return [
    `**DCO** ✗ ${count} missing a matching \`Signed-off-by\` trailer.`,
    '',
    '| Commit | Author | Reason |',
    '| --- | --- | --- |',
    ...rows,
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
    'case-insensitively; the name is never compared. Merge commits and `[bot]`-authored',
    `commits are exempt. See [the DCO section of CONTRIBUTING.md](${CONTRIBUTING_DCO_URL}).`,
  ].join('\n');
}

function detail(verdict: Verdict): string {
  if (verdict.state === 'violation') {
    return violationReason(verdict);
  }
  if (verdict.state === 'exempt') {
    return verdict.reason === 'merge-commit' ? 'merge commit' : 'bot author';
  }
  return 'signed off';
}

function identityCell(commit: CommitData): string {
  const author = `\`${escapeCell(`${commit.authorName} <${commit.authorEmail}>`)}\``;
  // Both identities are shown when they diverge: the mismatch reason names two
  // addresses, so a cell that shows one of them reads as a bug in the check.
  if (
    commit.committerEmail.toLowerCase() === commit.authorEmail.toLowerCase()
  ) {
    return author;
  }
  const committer = `\`${escapeCell(`${commit.committerName} <${commit.committerEmail}>`)}\``;
  return `${author}<br>committer ${committer}`;
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|');
}
