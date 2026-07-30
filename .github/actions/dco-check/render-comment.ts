import type { CommitData, Verdict, Violation } from './check-commits.ts';

// Must lead the body and appear exactly once: the sticky comment is located by
// searching existing comments for this substring, so a second occurrence
// anywhere in the body makes the find ambiguous.
export const COMMENT_MARKER = '<!-- dco-check -->';

export const CONTRIBUTING_DCO_URL =
  'https://github.com/maelstrom-co/maelstrom/blob/main/CONTRIBUTING.md#developer-certificate-of-origin-dco';

export function renderComment(verdicts: Verdict[]): string {
  const violations = verdicts.filter(isViolation);
  const body =
    violations.length === 0
      ? passBody(verdicts)
      : failBody(verdicts, violations);
  return `${COMMENT_MARKER}\n\n${body}\n`;
}

export function renderLogTable(verdicts: Verdict[]): string {
  return [
    row(['Commit', 'Author', 'Verdict', 'Detail']),
    row(['---', '---', '---', '---']),
    ...verdicts.map((verdict) =>
      row([
        code(shortSha(verdict.commit)),
        identityCell(verdict.commit),
        verdict.state,
        detail(verdict),
      ]),
    ),
  ].join('\n');
}

export function violationReason(verdict: Violation): string {
  if (verdict.reason === 'missing-sign-off') {
    return 'no Signed-off-by trailer';
  }
  const suffix =
    verdict.signedOffAs.length === 0
      ? ''
      : ` (signed off as ${verdict.signedOffAs.map(code).join(', ')})`;
  return `sign-off email matches neither author nor committer${suffix}`;
}

export function shortSha(commit: CommitData): string {
  return commit.sha.slice(0, 7);
}

function passBody(verdicts: Verdict[]): string {
  const signed = verdicts.filter(
    (verdict) => verdict.state === 'signed',
  ).length;
  if (signed === 0) {
    return `**DCO** ✓ no commit required a sign-off.${exemptNote(verdicts)}`;
  }
  const subject =
    signed === 1 ? 'the single commit carries' : `all ${signed} commits carry`;
  return `**DCO** ✓ ${subject} a matching \`Signed-off-by\` trailer.${exemptNote(verdicts)}`;
}

function exemptNote(verdicts: Verdict[]): string {
  const exempt = verdicts.filter(isExempt);
  if (exempt.length === 0) {
    return '';
  }
  const categories = Object.entries(EXEMPT_LABEL)
    .filter(([reason]) => exempt.some((verdict) => verdict.reason === reason))
    .map(([, label]) => `${label}s`);
  return ` (${exempt.length} exempt: ${categories.join(', ')})`;
}

function failBody(verdicts: Verdict[], violations: Violation[]): string {
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
    'case-insensitively; the name is never compared. Merge commits and `[bot]`-authored',
    `commits are exempt. See [the DCO section of CONTRIBUTING.md](${CONTRIBUTING_DCO_URL}).`,
  ].join('\n');
}

function detail(verdict: Verdict): string {
  switch (verdict.state) {
    case 'violation':
      return violationReason(verdict);
    case 'exempt':
      return EXEMPT_LABEL[verdict.reason];
    case 'signed':
      return 'signed off';
    default: {
      // A new Verdict state must not silently render as a pass.
      const unhandled: never = verdict;
      return unhandled;
    }
  }
}

// The one place an exempt reason is turned into prose. `satisfies` is what makes
// it load-bearing: a reason added to Verdict fails to compile until it has a
// label here, instead of being mislabelled as the last arm of a ternary. Key
// order is the order the categories are listed in on a pass.
const EXEMPT_LABEL = {
  'merge-commit': 'merge commit',
  'bot-author': 'bot author',
} as const satisfies Record<
  Extract<Verdict, { state: 'exempt' }>['reason'],
  string
>;

function identityCell(commit: CommitData): string {
  const author = code(`${commit.authorName} <${commit.authorEmail}>`);
  // Both identities are shown when they diverge: the mismatch reason names two
  // addresses, so a cell that shows one of them reads as a bug in the check.
  if (
    commit.committerEmail.toLowerCase() === commit.authorEmail.toLowerCase()
  ) {
    return author;
  }
  const committer = code(`${commit.committerName} <${commit.committerEmail}>`);
  return `${author}<br>committer ${committer}`;
}

// Names, emails, and sign-off addresses all come from a fork's commit metadata,
// and this comment is posted by a workflow holding `pull-requests: write` — so
// every one of those strings is chosen by whoever opened the pull request, and
// a contributor must not be able to shape the bot's own words. Hence the rule
// this file keeps: externally-sourced text is only ever rendered through
// `code()`, never interpolated into a row directly. The code span is what makes
// angle brackets, emphasis, and links inert; `escapeCell` covers the two
// characters that can leave the span.
function code(value: string): string {
  return `\`${escapeCell(value)}\``;
}

function escapeCell(value: string): string {
  // A backtick is substituted rather than escaped: backslash escapes do not
  // work inside a code span, so `\`` would still close it. GFM resolves `\|`
  // before inline parsing, so the pipe can be escaped in place.
  return value.replaceAll('|', '\\|').replaceAll('`', "'");
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function isViolation(verdict: Verdict): verdict is Violation {
  return verdict.state === 'violation';
}

function isExempt(
  verdict: Verdict,
): verdict is Extract<Verdict, { state: 'exempt' }> {
  return verdict.state === 'exempt';
}
