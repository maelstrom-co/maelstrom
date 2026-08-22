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

export async function findLatestGreenCommit(
  request: GitHubRequest,
): Promise<string> {
  for (let page = 1; ; page += 1) {
    const { workflow_runs: runs } = await request<WorkflowRunsResponse>(
      `/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=${perPage}&page=${page}`,
    );

    // The run-level conclusion covers every required job, including jobs added
    // after this selector was written. Job-name matching would silently miss a
    // second failed gate.
    for (const run of runs) {
      if (run.conclusion === 'success') {
        return run.head_sha;
      }
    }

    if (runs.length < perPage) {
      throw new Error('No successful main CI revision found');
    }
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repository || !token) {
    throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required');
  }

  const request: GitHubRequest = async <Result>(path: string) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}${path}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `GitHub API request failed (${response.status}): ${path}`,
      );
    }
    return (await response.json()) as Result;
  };

  console.log(await findLatestGreenCommit(request));
}

if (import.meta.main) {
  await main();
}
