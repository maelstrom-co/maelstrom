import type { CommitData } from '../policy/commit-data.ts';

export function shortSha(commit: CommitData): string {
  return commit.sha.slice(0, 7);
}
