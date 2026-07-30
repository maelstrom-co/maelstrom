import { type CommitData, checkCommits } from './check-commits.ts';
import {
  COMMENT_MARKER,
  renderComment,
  renderLogTable,
  shortSha,
  violationReason,
} from './render-comment.ts';

const API = 'https://api.github.com';
const PAGE_SIZE = 100;

interface CommitPayload {
  sha: string;
  commit: {
    message: string;
    author: { name?: string; email?: string } | null;
    committer: { name?: string; email?: string } | null;
  };
  author: { login?: string } | null;
  parents: unknown[];
}

interface CommentPayload {
  id: number;
  body?: string;
  user: { type?: string } | null;
}

async function main(): Promise<never> {
  const token = requireEnv('GITHUB_TOKEN');
  const repository = requireEnv('REPOSITORY');
  const prNumber = requireEnv('PR_NUMBER');

  const commits = await fetchCommits(token, repository, prNumber);
  const verdicts = checkCommits(commits);
  const violations = verdicts.filter(
    (verdict) => verdict.state === 'violation',
  );

  console.log('::group::DCO verdicts');
  console.log(renderLogTable(verdicts));
  console.log('::endgroup::');
  for (const violation of violations) {
    console.log(
      `::error title=DCO::${shortSha(violation.commit)} ${violationReason(violation)}`,
    );
  }

  // The check IS the verdict; the comment is UX. A failed upsert warns and
  // leaves the exit code alone, mirroring the cosmetic comment step in
  // publish-pr.yml.
  try {
    await upsertComment(token, repository, prNumber, renderComment(verdicts));
  } catch (error) {
    console.log(
      `::warning title=DCO::could not post the verdict comment: ${message(error)}`,
    );
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

async function fetchCommits(
  token: string,
  repository: string,
  prNumber: string,
): Promise<CommitData[]> {
  const commits: CommitData[] = [];
  // GitHub caps this endpoint at 250 commits however you paginate, so a PR
  // larger than that is only partially audited. probot/dco has the same
  // ceiling; PRs that big should be split.
  for (let page = 1; ; page += 1) {
    const payload = (await request(
      token,
      `${API}/repos/${repository}/pulls/${prNumber}/commits?per_page=${PAGE_SIZE}&page=${page}`,
    )) as CommitPayload[];
    if (!Array.isArray(payload)) {
      throw new Error(
        'unexpected payload from the pull-request commits endpoint',
      );
    }
    commits.push(...payload.map(toCommitData));
    if (payload.length < PAGE_SIZE) {
      return commits;
    }
  }
}

function toCommitData(payload: CommitPayload): CommitData {
  return {
    sha: payload.sha,
    message: payload.commit.message,
    authorName: payload.commit.author?.name ?? '',
    authorEmail: payload.commit.author?.email ?? '',
    committerName: payload.commit.committer?.name ?? '',
    committerEmail: payload.commit.committer?.email ?? '',
    authorLogin: payload.author?.login ?? null,
    parentCount: payload.parents.length,
  };
}

async function upsertComment(
  token: string,
  repository: string,
  prNumber: string,
  body: string,
): Promise<void> {
  const existing = await findComment(token, repository, prNumber);
  if (existing === undefined) {
    await request(
      token,
      `${API}/repos/${repository}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ body }),
      },
    );
    return;
  }
  await request(
    token,
    `${API}/repos/${repository}/issues/comments/${existing}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    },
  );
}

async function findComment(
  token: string,
  repository: string,
  prNumber: string,
): Promise<number | undefined> {
  for (let page = 1; ; page += 1) {
    const payload = (await request(
      token,
      `${API}/repos/${repository}/issues/${prNumber}/comments?per_page=${PAGE_SIZE}&page=${page}`,
    )) as CommentPayload[];
    // Requiring a Bot author means a human quoting the marker cannot hijack
    // the slot and make every later run edit their comment instead.
    const match = payload.find(
      (comment) =>
        comment.user?.type === 'Bot' && comment.body?.includes(COMMENT_MARKER),
    );
    if (match !== undefined) {
      return match.id;
    }
    if (payload.length < PAGE_SIZE) {
      return undefined;
    }
  }
}

async function request(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'maelstrom-dco-check',
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${url} → ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Fail closed: a required check must never pass because the API hiccupped.
await main().catch((error: unknown) => {
  console.log(`::error title=DCO::${message(error)}`);
  process.exit(1);
});
