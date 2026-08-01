import type { Config } from '../config/config.ts';
import type { CommitData } from '../policy/commit-data.ts';
import { API_BASE } from './api-base.ts';
import { type Pages, pages } from './pages.ts';
import { toCommitData } from './to-commit-data.ts';

export function createFetchCommits(pages: Pages) {
  return async function fetchCommits(config: Config): Promise<CommitData[]> {
    const { token, repository, prNumber } = config;
    const commits: CommitData[] = [];
    const url = `${API_BASE}/repos/${repository}/pulls/${prNumber}/commits`;
    for await (const payload of pages(token, url, COMMIT_PAGE_LIMIT)) {
      commits.push(...payload.map((entry) => toCommitData(entry)));
    }
    return commits;
  };
}

export type FetchCommits = ReturnType<typeof createFetchCommits>;

export const fetchCommits = createFetchCommits(pages);

// Generous: the 250-commit API ceiling makes page 3 the last one that can
// carry commits.
const COMMIT_PAGE_LIMIT = 5;
