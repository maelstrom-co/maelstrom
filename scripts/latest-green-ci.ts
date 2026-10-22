interface WorkflowRun {
  conclusion: string | null;
  head_sha: string;
  id: number;
}

interface WorkflowRunsResponse {
  workflow_runs: WorkflowRun[];
}

export type GitHubRequest = <Result>(path: string) => Promise<Result>;

const perPage = 100;
const retryDelays = [1000, 2000, 4000, 8000] as const;
const missingRevisionMessage = 'No successful main CI revision found';
const invalidRevisionMessage = 'GitHub returned an invalid CI revision';

interface LookupFailure {
  attempt: number;
  totalAttempts: number;
  pages: number;
  returnedRuns: number;
  retryAfterMs: number | undefined;
}

interface LookupOptions {
  sleep?: (milliseconds: number) => Promise<void>;
  onUnavailable?: (failure: LookupFailure) => void;
}

export async function findLatestGreenCommit(
  request: GitHubRequest,
  options: LookupOptions = {},
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    let page = 1;
    let returnedRuns = 0;
    for (; ; page += 1) {
      const { workflow_runs: runs } = await request<WorkflowRunsResponse>(
        `/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=${perPage}&page=${page}`,
      );
      returnedRuns += runs.length;

      // The run-level conclusion covers every required job, including jobs added
      // after this selector was written. Job-name matching would silently miss a
      // second failed gate.
      for (const run of runs) {
        if (run.conclusion === 'success') {
          return run.head_sha;
        }
      }
      if (runs.length < perPage) break;
    }

    const retryAfterMs = retryDelays[attempt - 1];
    options.onUnavailable?.({
      attempt,
      totalAttempts: retryDelays.length + 1,
      pages: page,
      returnedRuns,
      retryAfterMs,
    });
    if (retryAfterMs === undefined) throw new Error(missingRevisionMessage);
    await (options.sleep ?? Bun.sleep)(retryAfterMs);
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repository || !token) {
    throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required');
  }

  const requestId = crypto.randomUUID();
  let httpStatus: number | undefined;
  let githubRequestId: string | undefined;
  let attempt = 1;
  const report = (
    level: 'info' | 'warn' | 'error',
    event: string,
    fields: Record<string, string | number | undefined>,
  ) => {
    console.error(
      JSON.stringify({
        ...fields,
        event,
        level,
        requestId,
        httpStatus,
        githubRequestId,
      }),
    );
  };
  const request: GitHubRequest = async <Result>(path: string) => {
    httpStatus = undefined;
    githubRequestId = undefined;
    const response = await fetch(
      `https://api.github.com/repos/${repository}${path}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'X-Request-ID': requestId,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    httpStatus = response.status;
    const upstreamId = response.headers.get('x-github-request-id');
    if (upstreamId && /^[0-9a-f:]{1,128}$/i.test(upstreamId))
      githubRequestId = upstreamId;
    if (!response.ok) {
      throw new Error(
        `GitHub API request failed (${response.status}): ${path}`,
      );
    }
    return (await response.json()) as Result;
  };

  try {
    const revision = await findLatestGreenCommit(request, {
      onUnavailable: (failure) => {
        attempt = Math.min(failure.attempt + 1, failure.totalAttempts);
        report('warn', 'ci_revision_lookup_unavailable', { ...failure });
      },
    });
    if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/i.test(revision)) {
      throw new Error(invalidRevisionMessage);
    }
    report('info', 'ci_revision_lookup_succeeded', { attempt, revision });
    console.log(revision);
  } catch (error) {
    const lookupMessage = error instanceof Error ? error.message : undefined;
    let reason = 'request_failed';
    let message = 'GitHub CI revision lookup failed';
    if (lookupMessage === missingRevisionMessage) {
      reason = 'no_successful_revision';
      message = missingRevisionMessage;
    } else if (lookupMessage === invalidRevisionMessage) {
      reason = 'invalid_response';
      message = invalidRevisionMessage;
    }
    report('error', 'ci_revision_lookup_failed', {
      attempt,
      reason,
      message,
    });
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
