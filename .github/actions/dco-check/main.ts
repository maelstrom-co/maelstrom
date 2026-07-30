import { type CommitData, checkCommits } from './check-commits.ts';
import { toCommitData } from './commit-payload.ts';
import {
  COMMENT_MARKER,
  renderComment,
  renderLogTable,
  shortSha,
  violationReason,
} from './render-comment.ts';

const API = 'https://api.github.com';
const PAGE_SIZE = 100;
// GitHub caps the pull-request commits endpoint at 250 however you paginate,
// so a larger pull request can only ever be partially audited — we fail closed
// rather than report a pass over commits nobody looked at.
const COMMIT_CEILING = 250;
// Generous: the ceiling above makes page 3 the last one that can carry commits.
const COMMIT_PAGE_LIMIT = 5;
const COMMENT_PAGE_LIMIT = 20;

async function main(): Promise<never> {
  const token = requireEnv('GITHUB_TOKEN');
  const repository = requireEnv('REPOSITORY');
  const prNumber = requireEnv('PR_NUMBER');

  const commits = await fetchCommits(token, repository, prNumber);
  // A real pull request always has a commit, and the endpoint is known to
  // answer 200 with `[]` before the merge ref is computed. Zero commits means
  // the audit did not happen, not that it passed.
  if (commits.length === 0) {
    console.log(
      '::error title=DCO::the pull-request commits endpoint returned no commits — refusing to pass a check that audited nothing',
    );
    process.exit(1);
  }
  if (commits.length >= COMMIT_CEILING) {
    console.log(
      `::error title=DCO::this pull request exceeds the ${COMMIT_CEILING}-commit API ceiling; only the first ${COMMIT_CEILING} commits could be audited — split the pull request`,
    );
    process.exit(1);
  }

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

  // Rendered outside the try so a defect in the renderer fails the run rather
  // than being reported as a failure to post.
  const body = renderComment(verdicts);
  // The check IS the verdict; the comment is UX. A failed upsert annotates and
  // leaves the exit code alone.
  try {
    await upsertComment(token, repository, prNumber, body);
  } catch (error) {
    // A denied comment never self-heals — every later run fails the same way,
    // and a fork contributor staring at a red check has no other explanation
    // anywhere. An annotation does not move the exit code, so saying so loudly
    // costs nothing.
    const denied =
      error instanceof RequestError &&
      (error.status === 401 || error.status === 403);
    const severity = denied ? 'error' : 'warning';
    const hint = denied
      ? ' — check that GITHUB_TOKEN has pull-requests: write'
      : '';
    console.log(
      `::${severity} title=DCO::could not post the verdict comment (${message(error)})${hint}`,
    );
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

async function fetchCommits(
  token: string,
  repository: string,
  prNumber: string,
): Promise<CommitData[]> {
  const commits: CommitData[] = [];
  const url = `${API}/repos/${repository}/pulls/${prNumber}/commits`;
  for await (const payload of pages(token, url, COMMIT_PAGE_LIMIT)) {
    commits.push(...payload.map((entry) => toCommitData(entry)));
  }
  return commits;
}

async function upsertComment(
  token: string,
  repository: string,
  prNumber: string,
  body: string,
): Promise<void> {
  const existing = await findComment(token, repository, prNumber);
  const { method, url } =
    existing === undefined
      ? {
          method: 'POST',
          url: `${API}/repos/${repository}/issues/${prNumber}/comments`,
        }
      : {
          method: 'PATCH',
          url: `${API}/repos/${repository}/issues/comments/${existing}`,
        };
  await request(token, url, { method, body: JSON.stringify({ body }) });
}

async function findComment(
  token: string,
  repository: string,
  prNumber: string,
): Promise<number | undefined> {
  const url = `${API}/repos/${repository}/issues/${prNumber}/comments`;
  for await (const payload of pages(token, url, COMMENT_PAGE_LIMIT)) {
    for (const entry of payload) {
      const id = markerCommentId(entry);
      if (id !== undefined) {
        return id;
      }
    }
  }
  return undefined;
}

function markerCommentId(entry: unknown): number | undefined {
  const comment = asRecord(entry);
  // Requiring a Bot author means a human quoting the marker cannot hijack the
  // slot and make every later run edit their comment instead.
  if (asRecord(comment?.user)?.type !== 'Bot') {
    return undefined;
  }
  const body = comment?.body;
  if (typeof body !== 'string' || !body.includes(COMMENT_MARKER)) {
    return undefined;
  }
  return typeof comment?.id === 'number' ? comment.id : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

async function* pages(
  token: string,
  url: string,
  pageLimit: number,
): AsyncGenerator<unknown[]> {
  for (let page = 1; page <= pageLimit; page += 1) {
    const payload = await request(
      token,
      `${url}?per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(payload)) {
      throw new Error(`expected a list of results from ${url}`);
    }
    yield payload;
    if (payload.length < PAGE_SIZE) {
      return;
    }
  }
  // Only a short page or a throw ends this loop, so anything replaying a full
  // page forever would otherwise hold the required check pending with no
  // diagnostic at all.
  throw new PaginationLimitError(url, pageLimit);
}

class PaginationLimitError extends Error {
  constructor(url: string, pageLimit: number) {
    super(
      `${url} still returned a full page after ${pageLimit} pages — refusing to paginate further`,
    );
    this.name = 'PaginationLimitError';
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
    // This message is the only diagnostic a failed run leaves behind, and the
    // status alone cannot distinguish a permission the org disabled from a
    // secondary rate limit — `statusText` is empty over HTTP/2, and the
    // actionable reason lives in the body. Collapsed to one line because a
    // workflow annotation is single-line.
    const detail = (await response.text().catch(() => ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    throw new RequestError(
      response.status,
      [
        `${init.method ?? 'GET'} ${url} → ${response.status} ${response.statusText}`.trimEnd(),
        rateLimitDetail(response),
        detail,
      ]
        .filter((part) => part !== '')
        .join(' — '),
    );
  }
  return response.json();
}

function rateLimitDetail(response: Response): string {
  if (response.status !== 403 && response.status !== 429) {
    return '';
  }
  return (['x-ratelimit-remaining', 'retry-after'] as const)
    .map((header) => [header, response.headers.get(header)] as const)
    .filter(([, value]) => value !== null)
    .map(([header, value]) => `${header}: ${value}`)
    .join(', ');
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
