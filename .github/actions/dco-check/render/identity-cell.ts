import type { CommitData } from '../policy/commit-data.ts';
import { CELL_LIMIT } from './cell-limit.ts';
import { code } from './code.ts';
import { truncate } from './truncate.ts';

export function identityCell(commit: CommitData): string {
  const author = identity(commit.authorName, commit.authorEmail);
  // Both identities are shown when they diverge: the mismatch reason names two
  // addresses, so a cell that shows one of them reads as a bug in the check.
  if (
    commit.committerEmail.toLowerCase() === commit.authorEmail.toLowerCase()
  ) {
    return author;
  }
  const committer = identity(commit.committerName, commit.committerEmail);
  return `${author}<br>committer ${committer}`;
}

// The name and the address are bounded separately so a long name cannot spend
// the address's budget: the address is the part the verdict turns on.
function identity(name: string, email: string): string {
  return code(`${truncate(name, CELL_LIMIT)} <${truncate(email, CELL_LIMIT)}>`);
}
