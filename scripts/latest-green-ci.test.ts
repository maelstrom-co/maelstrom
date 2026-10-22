import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

import { findLatestGreenCommit, type GitHubRequest } from './latest-green-ci';

const run = (id: number, headSha: string, conclusion: string | null) => ({
  conclusion,
  head_sha: headSha,
  id,
});
const runsResponse = (runs: ReturnType<typeof run>[]) => ({
  workflow_runs: runs,
});

const runCliFixture = async (extraEnv: Record<string, string> = {}) => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--preload',
      join(import.meta.dir, 'fixtures/latest-green-ci-fetch.fixture.ts'),
      join(import.meta.dir, 'latest-green-ci.ts'),
    ],
    {
      env: {
        PATH: process.env.PATH ?? '',
        GH_TOKEN: 'fixture',
        GITHUB_REPOSITORY: 'fixture/ci',
        ...extraEnv,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
};

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
    let calls = 0;
    const waits: number[] = [];
    const reports: unknown[] = [];
    const request: GitHubRequest = async <Result>(_path: string) => {
      calls += 1;
      return runsResponse([run(1, 'do-not-log-response', 'failure')]) as Result;
    };

    await expect(
      findLatestGreenCommit(request, {
        sleep: async (milliseconds) => {
          waits.push(milliseconds);
        },
        onUnavailable: (report) => {
          reports.push(report);
        },
      }),
    ).rejects.toThrow('No successful main CI revision found');
    expect(calls).toBe(5);
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
    expect(reports).toHaveLength(5);
    expect(reports.at(-1)).toMatchObject({
      attempt: 5,
      totalAttempts: 5,
      pages: 1,
      returnedRuns: 1,
    });
    expect(JSON.stringify(reports)).not.toContain('do-not-log-response');
  });

  it('recovers when GitHub temporarily omits the passing main revision', async () => {
    let calls = 0;
    const waits: number[] = [];
    const request: GitHubRequest = async <Result>(_path: string) => {
      calls += 1;
      return runsResponse(
        calls === 1 ? [] : [run(1, 'green', 'success')],
      ) as Result;
    };
    expect(
      await findLatestGreenCommit(request, {
        sleep: async (milliseconds) => {
          waits.push(milliseconds);
        },
      }),
    ).toBe('green');
    expect(calls).toBe(2);
    expect(waits).toEqual([1000]);
  });

  it('restarts pagination so a revision that just turned green is not missed', async () => {
    const paths: string[] = [];
    const redRuns = Array.from({ length: 100 }, (_, index) =>
      run(index + 2, `red-${index}`, 'failure'),
    );
    const request: GitHubRequest = async <Result>(path: string) => {
      paths.push(path);
      if (paths.length === 1) return runsResponse(redRuns) as Result;
      if (paths.length === 2) return runsResponse([]) as Result;
      return runsResponse([run(3, 'new-green', 'success')]) as Result;
    };
    expect(
      await findLatestGreenCommit(request, { sleep: async () => {} }),
    ).toBe('new-green');
    expect(
      paths.map((path) =>
        new URL(`https://api.github.com${path}`).searchParams.get('page'),
      ),
    ).toEqual(['1', '2', '1']);
  });

  it('does not hide request failures behind missing-revision retries', async () => {
    let calls = 0;
    let sleeps = 0;
    const failure = new Error('GitHub API request failed (403)');
    const request: GitHubRequest = async <Result>(
      _path: string,
    ): Promise<Result> => {
      calls += 1;
      throw failure;
    };
    await expect(
      findLatestGreenCommit(request, {
        sleep: async () => {
          sleeps += 1;
        },
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
    expect(sleeps).toBe(0);
  });

  it('keeps the CLI revision usable and credentials out of recovery diagnostics', async () => {
    const { stdout, stderr, code } = await runCliFixture();
    expect(code).toBe(0);
    expect(stdout).toBe(`${'a'.repeat(40)}\n`);
    const events = stderr
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual([
      'ci_revision_lookup_unavailable',
      'ci_revision_lookup_succeeded',
    ]);
    expect(events[0]).toMatchObject({
      attempt: 1,
      totalAttempts: 5,
      pages: 1,
      returnedRuns: 0,
      retryAfterMs: 1000,
    });
    expect(events[1]).toMatchObject({ attempt: 2, revision: 'a'.repeat(40) });
    expect(new Set(events.map((event) => event.requestId)).size).toBe(1);
    expect(events[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(`${stdout}${stderr}`).not.toContain('Bearer fixture');
    expect(`${stdout}${stderr}`).not.toContain('do-not-log-response');
  });

  it('fails the CLI without leaking a rejected provider response', async () => {
    const { stdout, stderr, code } = await runCliFixture({
      LOOKUP_HTTP_FAILURE: '1',
    });
    expect(code).toBe(1);
    expect(stdout).toBe('');
    const event = JSON.parse(stderr.trim());
    expect(event).toMatchObject({
      event: 'ci_revision_lookup_failed',
      level: 'error',
      reason: 'request_failed',
      httpStatus: 503,
    });
    expect(event.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stderr).not.toContain('Bearer fixture');
    expect(stderr).not.toContain('do-not-log-response');
  });

  it('never emits an unvalidated revision as a deployment target or diagnostic', async () => {
    const { stdout, stderr, code } = await runCliFixture({
      LOOKUP_INVALID_REVISION: '1',
    });
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr.trim())).toMatchObject({
      event: 'ci_revision_lookup_failed',
      reason: 'invalid_response',
    });
    expect(stderr).not.toContain('do-not-log-response');
  });
});
