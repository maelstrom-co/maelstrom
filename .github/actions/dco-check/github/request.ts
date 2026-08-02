import { RequestError } from './request-error.ts';

export function createRequest(doFetch: DoFetch) {
  return async function request(
    token: string,
    url: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    // Layered onto any caller-supplied headers, last-write-wins, so a caller
    // can't displace Authorization by accident. Flip the order only if that
    // guarantee is meant to change.
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    headers.set('User-Agent', 'maelstrom-dco-check');
    headers.set('Content-Type', 'application/json');
    const response = await doFetch(url, { ...init, headers });
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
  };
}

export type Request = ReturnType<typeof createRequest>;

// Every module downstream of here must take its collaborator as a factory
// argument rather than import this binding: doing the latter reaches the real
// network from a test and nothing mechanical catches it, so it is a review rule.
export const request = createRequest((...args) => fetch(...args));

// Only the call signature is the dependency: `typeof fetch` under Bun's types is
// the function *and* its `fetch.preconnect` namespace, which nothing here calls
// and no substitute could supply.
type DoFetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

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
