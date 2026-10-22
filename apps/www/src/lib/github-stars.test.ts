import { expect, spyOn, test } from 'bun:test';
import { getGitHubStarCount } from './github-stars';

test('browser refreshes use a public CORS request without credentials or page referrers', async () => {
  const request = (async (input, options) => {
    expect(input).toBe('https://api.github.com/repos/maelstrom-co/maelstrom');
    expect(options?.credentials).toBe('omit');
    expect(options?.referrerPolicy).toBe('no-referrer');
    expect(Object.fromEntries(new Headers(options?.headers))).toEqual({
      accept: 'application/vnd.github+json',
    });
    return Response.json({ stargazers_count: 12 });
  }) as typeof fetch;
  expect(await getGitHubStarCount(request)).toBe(12);
});

test('shows the real star count, including a repository with zero stars', async () => {
  for (const count of [0, 1234]) {
    const request = (async () =>
      Response.json({ stargazers_count: count })) as typeof fetch;
    expect(await getGitHubStarCount(request)).toBe(count);
  }
});

test('renders prefetched public counts without another unauthenticated GitHub request', async () => {
  let calls = 0;
  const request = (async () => {
    calls += 1;
    return new Response(null, { status: 403 });
  }) as typeof fetch;
  for (const count of ['0', '1234']) {
    expect(await getGitHubStarCount(request, count)).toBe(Number(count));
  }
  expect(calls).toBe(0);
});

test('rejects invalid prefetched metadata without exposing it in diagnostics', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  let calls = 0;
  const request = (async () => {
    calls += 1;
    return Response.json({ stargazers_count: 5 });
  }) as typeof fetch;
  try {
    for (const count of [
      '-1',
      '1.5',
      '1e2',
      '01',
      '9007199254740992',
      'do-not-log-response',
    ]) {
      expect(await getGitHubStarCount(request, count)).toBeUndefined();
    }
    expect(calls).toBe(0);
    expect(warn).toHaveBeenCalledTimes(6);
    expect(
      warn.mock.calls.every(
        ([line]) =>
          JSON.parse(String(line)).reason === 'invalid_prefetched_count',
      ),
    ).toBe(true);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'do-not-log-response',
    );
  } finally {
    warn.mockRestore();
  }
});

test('keeps the public API fallback for local builds without prefetched metadata', async () => {
  let calls = 0;
  const request = (async () => {
    calls += 1;
    return Response.json({ stargazers_count: 5 });
  }) as typeof fetch;
  expect(await getGitHubStarCount(request, undefined)).toBe(5);
  expect(await getGitHubStarCount(request, '')).toBe(5);
  expect(calls).toBe(2);
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
