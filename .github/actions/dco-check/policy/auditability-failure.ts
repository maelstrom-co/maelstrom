import type { CommitData } from './commit-data.ts';

export function auditabilityFailure(commits: CommitData[]): string | undefined {
  // A real pull request always has a commit, and the endpoint is known to
  // answer 200 with `[]` before the merge ref is computed. Zero commits means
  // the audit did not happen, not that it passed.
  if (commits.length === 0) {
    return 'the pull-request commits endpoint returned no commits — refusing to pass a check that audited nothing';
  }
  if (commits.length >= COMMIT_CEILING) {
    return `this pull request exceeds the ${COMMIT_CEILING}-commit API ceiling; only the first ${COMMIT_CEILING} commits could be audited — split the pull request`;
  }
  return undefined;
}

// GitHub caps the pull-request commits endpoint at 250 however you paginate,
// so a larger pull request can only ever be partially audited — we fail closed
// rather than report a pass over commits nobody looked at.
const COMMIT_CEILING = 250;
