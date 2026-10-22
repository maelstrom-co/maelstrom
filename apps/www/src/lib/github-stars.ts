const REPOSITORY_API = 'https://api.github.com/repos/maelstrom-co/maelstrom';
const isStarCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export async function getGitHubStarCount(
  request: typeof fetch = fetch,
  prefetchedCount?: string,
): Promise<number | undefined> {
  const requestId = crypto.randomUUID();
  const unavailable = (
    reason:
      | 'http_error'
      | 'request_failed'
      | 'invalid_response'
      | 'invalid_prefetched_count',
    status?: number,
  ) => {
    console.warn(
      JSON.stringify({
        event: 'github_stars_unavailable',
        requestId,
        reason,
        ...(status === undefined ? {} : { status }),
      }),
    );
    return undefined;
  };
  if (prefetchedCount !== undefined && prefetchedCount !== '') {
    const count = Number(prefetchedCount);
    return /^(0|[1-9]\d*)$/.test(prefetchedCount) && isStarCount(count)
      ? count
      : unavailable('invalid_prefetched_count');
  }
  try {
    const response = await request(REPOSITORY_API, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return unavailable('http_error', response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('stargazers_count' in body)) {
      return unavailable('invalid_response');
    }
    const count = body.stargazers_count;
    return isStarCount(count) ? count : unavailable('invalid_response');
  } catch {
    // A private repository or unavailable API must not prevent a site build.
    return unavailable('request_failed');
  }
}
