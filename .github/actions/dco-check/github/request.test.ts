import { describe, expect, it } from 'bun:test';
import { createRequest } from './request.ts';
import { RequestError } from './request-error.ts';

const TOKEN = 'ghs_token';
const URL = 'https://api.github.com/repos/o/r/pulls/7/commits';

describe('request', () => {
  it('returns the parsed body of a successful response', async () => {
    const request = createRequest(async () => json([{ sha: 'abc' }]));
    expect(await request(TOKEN, URL)).toEqual([{ sha: 'abc' }]);
  });

  it('sends the token as a bearer credential', async () => {
    let sent: RequestInit | undefined;
    const request = createRequest(async (_url, init) => {
      sent = init;
      return json({});
    });
    await request(TOKEN, URL, { method: 'POST', body: '{}' });
    expect(sent?.method).toBe('POST');
    expect(sent?.body).toBe('{}');
    const headers = new Headers(sent?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
  });

  it('keeps a caller-supplied header that does not collide', async () => {
    let sent: RequestInit | undefined;
    const request = createRequest(async (_url, init) => {
      sent = init;
      return json({});
    });
    await request(TOKEN, URL, { headers: { 'X-Custom': 'value' } });
    const headers = new Headers(sent?.headers);
    expect(headers.get('X-Custom')).toBe('value');
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('lets its own Authorization header win over a caller-supplied one', async () => {
    let sent: RequestInit | undefined;
    const request = createRequest(async (_url, init) => {
      sent = init;
      return json({});
    });
    await request(TOKEN, URL, {
      headers: { Authorization: 'Bearer forged' },
    });
    const headers = new Headers(sent?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('throws a RequestError carrying the status of a failed response', async () => {
    const request = createRequest(
      async () => new Response('Not Found', { status: 404 }),
    );
    const error = await requestError(request(TOKEN, URL));
    expect(error.status).toBe(404);
    expect(error.message).toContain(`GET ${URL} → 404`);
    expect(error.message).toContain('Not Found');
  });

  it('names the method of a non-GET request in the message', async () => {
    const request = createRequest(
      async () => new Response('', { status: 500 }),
    );
    const error = await requestError(
      request(TOKEN, URL, { method: 'PATCH', body: '{}' }),
    );
    expect(error.message).toContain(`PATCH ${URL} → 500`);
  });

  it('adds the rate-limit headers to a throttled response', async () => {
    // The status alone cannot tell a disabled permission from a secondary rate
    // limit, and 403 is what GitHub answers with in both cases.
    const request = createRequest(
      async () =>
        new Response('rate limited', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' },
        }),
    );
    const error = await requestError(request(TOKEN, URL));
    expect(error.message).toContain(
      'x-ratelimit-remaining: 0, retry-after: 60',
    );
  });

  it('adds the rate-limit headers to a 429', async () => {
    const request = createRequest(
      async () =>
        new Response('', {
          status: 429,
          headers: { 'retry-after': '120' },
        }),
    );
    const error = await requestError(request(TOKEN, URL));
    expect(error.message).toContain('retry-after: 120');
  });

  it('leaves the rate-limit headers off any other failure', async () => {
    // The headers ride along on every GitHub response, so the status is what
    // decides whether quoting them back is honest.
    const request = createRequest(
      async () =>
        new Response('', {
          status: 404,
          headers: { 'x-ratelimit-remaining': '4999' },
        }),
    );
    const error = await requestError(request(TOKEN, URL));
    expect(error.message).not.toContain('x-ratelimit-remaining');
  });

  it('collapses a multi-line body onto one line', async () => {
    // A workflow annotation is single-line, so a body that kept its newlines
    // would lose everything after the first one.
    const request = createRequest(
      async () =>
        new Response('  Resource not accessible\n\n  by integration  ', {
          status: 403,
        }),
    );
    const error = await requestError(request(TOKEN, URL));
    expect(error.message).toContain('Resource not accessible by integration');
    expect(error.message).not.toContain('\n');
  });

  it('slices the body at 500 characters', async () => {
    const request = createRequest(
      async () => new Response('a'.repeat(600), { status: 500 }),
    );
    const error = await requestError(request(TOKEN, URL));
    expect(error.message).toContain('a'.repeat(500));
    expect(error.message).not.toContain('a'.repeat(501));
  });

  it('still reports a failure whose body cannot be read', async () => {
    // A truncated response must not turn a diagnosable failure into an
    // unhandled rejection from the diagnostic itself.
    const request = createRequest(
      async () =>
        new Response(
          new ReadableStream({
            start: (controller) => controller.error(new Error('stream closed')),
          }),
          { status: 502 },
        ),
    );
    const error = await requestError(request(TOKEN, URL));
    expect(error.status).toBe(502);
    expect(error.message).toContain(`GET ${URL} → 502`);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

async function requestError(promise: Promise<unknown>): Promise<RequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RequestError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the request to reject');
}
