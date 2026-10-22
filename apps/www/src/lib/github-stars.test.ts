import { expect, spyOn, test } from 'bun:test';
import { getGitHubStarCount } from './github-stars';

test('shows the real star count, including a repository with zero stars', async () => {
  for (const count of [0, 1234]) {
    const request = (async () =>
      Response.json({ stargazers_count: count })) as typeof fetch;
    expect(await getGitHubStarCount(request)).toBe(count);
  }
});

test('never invents a count when GitHub is private, unavailable, or returns invalid data', async () => {
  for (const body of [
    {},
    null,
    { stargazers_count: -1 },
    { stargazers_count: '12' },
    { stargazers_count: 1.5 },
  ]) {
    const request = (async () => Response.json(body)) as typeof fetch;
    expect(await getGitHubStarCount(request)).toBeUndefined();
  }
  expect(
    await getGitHubStarCount(
      (async () => new Response(null, { status: 404 })) as typeof fetch,
    ),
  ).toBeUndefined();
  expect(
    await getGitHubStarCount((async () => {
      throw new Error('offline');
    }) as typeof fetch),
  ).toBeUndefined();
});

test('a missing count leaves a bounded diagnostic without response or exception secrets', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(
      await getGitHubStarCount((async () =>
        Response.json({ stargazers_count: 0 })) as typeof fetch),
    ).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    const requests = [
      (async () =>
        new Response('private response details', {
          status: 503,
        })) as typeof fetch,
      (async () => {
        throw new Error('private exception details');
      }) as typeof fetch,
      (async () =>
        Response.json({
          stargazers_count: 'private invalid data',
        })) as typeof fetch,
    ];
    for (const request of requests)
      expect(await getGitHubStarCount(request)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
    const events = warn.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(events.map((event) => event.reason)).toEqual([
      'http_error',
      'request_failed',
      'invalid_response',
    ]);
    expect(events[0].status).toBe(503);
    for (const event of events) {
      expect(event.event).toBe('github_stars_unavailable');
      expect(event.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  } finally {
    warn.mockRestore();
  }
});
