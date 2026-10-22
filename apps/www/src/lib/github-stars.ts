const REPOSITORY_API = 'https://api.github.com/repos/maelstrom-co/maelstrom';

export async function getGitHubStarCount(
  request: typeof fetch = fetch,
): Promise<number | undefined> {
  const requestId = crypto.randomUUID();
  const unavailable = (
    reason: 'http_error' | 'request_failed' | 'invalid_response',
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
  try {
    const response = await request(REPOSITORY_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-Request-ID': requestId,
      },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return unavailable('http_error', response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('stargazers_count' in body)) {
      return unavailable('invalid_response');
    }
    const count = body.stargazers_count;
    return typeof count === 'number' &&
      Number.isSafeInteger(count) &&
      count >= 0
      ? count
      : unavailable('invalid_response');
  } catch {
    // A private repository or unavailable API must not prevent a site build.
    return unavailable('request_failed');
  }
}
