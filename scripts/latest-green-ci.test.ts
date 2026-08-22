import { describe, expect, it } from 'bun:test';

import { findLatestGreenCommit, type GitHubRequest } from './latest-green-ci';

const run = (id: number, headSha: string, conclusion: string | null) => ({
  conclusion,
  head_sha: headSha,
  id,
});
const runsResponse = (runs: ReturnType<typeof run>[]) => ({
  workflow_runs: runs,
});

describe('findLatestGreenCommit', () => {
  it('prevents a stale deployment by selecting the newest green revision', async () => {
    const request: GitHubRequest = async <Result>(path: string) => {
      expect(path).toContain('branch=main&event=push');
      return runsResponse([
        run(2, 'new-green', 'success'),
        run(1, 'old-green', 'success'),
      ]) as Result;
    };

    expect(await findLatestGreenCommit(request)).toBe('new-green');
  });

  it('deploys the latest green revision when newer main commits failed', async () => {
    const request: GitHubRequest = async <Result>(_path: string) =>
      runsResponse([
        run(2, 'new-red', 'failure'),
        run(1, 'old-green', 'success'),
      ]) as Result;

    expect(await findLatestGreenCommit(request)).toBe('old-green');
  });

  // A green `main` job next to a failed required job is not a deployable
  // revision; the run-level conclusion must gate the selection.
  it('rejects a run whose workflow conclusion failed despite a green job', async () => {
    const request: GitHubRequest = async <Result>(_path: string) =>
      runsResponse([
        run(2, 'mixed', 'failure'),
        run(1, 'green', 'success'),
      ]) as Result;

    expect(await findLatestGreenCommit(request)).toBe('green');
  });

  it('treats an in-progress run as undeployable', async () => {
    const request: GitHubRequest = async <Result>(_path: string) =>
      runsResponse([
        run(2, 'running', null),
        run(1, 'green', 'success'),
      ]) as Result;

    expect(await findLatestGreenCommit(request)).toBe('green');
  });

  it('continues beyond one API page after a long broken-main sequence', async () => {
    const redRuns = Array.from({ length: 100 }, (_, index) =>
      run(index + 2, `red-${index}`, 'failure'),
    );
    const request: GitHubRequest = async <Result>(path: string) => {
      if (path.endsWith('&page=1')) {
        return runsResponse(redRuns) as Result;
      }
      return runsResponse([run(1, 'green', 'success')]) as Result;
    };

    expect(await findLatestGreenCommit(request)).toBe('green');
  });

  it('fails when no revision ever went green', async () => {
    const request: GitHubRequest = async <Result>(_path: string) =>
      runsResponse([run(1, 'red', 'failure')]) as Result;

    expect(async () => findLatestGreenCommit(request)).toThrow(
      'No successful main CI revision found',
    );
  });
});
