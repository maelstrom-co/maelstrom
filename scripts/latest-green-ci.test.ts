import { describe, expect, it } from 'bun:test';

import { findLatestGreenCommit, type GitHubRequest } from './latest-green-ci';

const run = (id: number, headSha: string) => ({ head_sha: headSha, id });
const jobs = (conclusion: 'failure' | 'success') => ({
  jobs: [
    {
      conclusion,
      name: 'main',
    },
  ],
});

describe('findLatestGreenCommit', () => {
  it('prevents a stale deployment by selecting the newest green revision', async () => {
    const request: GitHubRequest = async <Result>(path: string) => {
      if (path.startsWith('/actions/workflows/')) {
        expect(path).toContain('branch=main&event=push');
        return {
          workflow_runs: [run(2, 'new-green'), run(1, 'old-green')],
        } as Result;
      }
      return jobs('success') as Result;
    };

    expect(await findLatestGreenCommit(request)).toBe('new-green');
  });

  it('deploys the latest green revision when newer main commits failed', async () => {
    const request: GitHubRequest = async <Result>(path: string) => {
      if (path.startsWith('/actions/workflows/')) {
        return {
          workflow_runs: [run(2, 'new-red'), run(1, 'old-green')],
        } as Result;
      }
      return jobs(path.includes('/runs/2/') ? 'failure' : 'success') as Result;
    };

    expect(await findLatestGreenCommit(request)).toBe('old-green');
  });

  it('continues beyond one API page after a long broken-main sequence', async () => {
    const redRuns = Array.from({ length: 100 }, (_, index) =>
      run(index + 2, `red-${index}`),
    );
    const request: GitHubRequest = async <Result>(path: string) => {
      if (path.endsWith('&page=1')) {
        return { workflow_runs: redRuns } as Result;
      }
      if (path.startsWith('/actions/workflows/')) {
        return { workflow_runs: [run(1, 'green')] } as Result;
      }
      return jobs(path.includes('/runs/1/') ? 'success' : 'failure') as Result;
    };

    expect(await findLatestGreenCommit(request)).toBe('green');
  });
});
