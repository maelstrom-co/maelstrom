import { RequestError } from './request-error.ts';

export async function request(
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
