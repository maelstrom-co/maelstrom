import type { CommitData } from '../policy/commit-data.ts';
import { code } from './code.ts';

export function identityCell(commit: CommitData): string {
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
