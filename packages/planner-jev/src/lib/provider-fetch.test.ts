import { describe, expect, test } from 'bun:test';

import {
  type ErrorFieldsExtractor,
  postJson,
  type RawReplyResult,
} from './provider-fetch.js';

const KEY = 'fetch-secret-key-value';
const ENDPOINT = 'https://provider.test/v1/evaluate';

const fromTopLevel: ErrorFieldsExtractor = (body) =>
  typeof body === 'object' && body !== null
    ? (body as { type?: unknown; code?: unknown })
    : {};

function respond(status: number, body: string): typeof globalThis.fetch {
  return (async () =>
    new Response(body, { status })) as unknown as typeof globalThis.fetch;
}

function post(
  fetch: typeof globalThis.fetch,
  errorFields: ErrorFieldsExtractor,
): Promise<RawReplyResult> {
  return postJson({
    fetch,
    endpoint: ENDPOINT,
    apiKey: KEY,
    body: '{}',
    signal: new AbortController().signal,
    errorFields,
  });
}

describe('postJson error fields', () => {
  test('hands the parsed error body to the extractor and keeps the fields it returns', async () => {
    const seen: unknown[] = [];
    const result = await post(
      respond(400, JSON.stringify({ type: 'bad_request', code: 'E1:x.y-z' })),
      (body) => {
        seen.push(body);
        return fromTopLevel(body);
      },
    );
    expect(seen).toEqual([{ type: 'bad_request', code: 'E1:x.y-z' }]);
    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 400,
        errorType: 'bad_request',
        errorCode: 'E1:x.y-z',
      },
    });
  });

  test.each<[string, unknown]>([
    ['a number', 401],
    ['an object', { nested: 'value' }],
    ['an empty string', ''],
    ['a string over 64 characters', 'a'.repeat(65)],
    ['a string with spaces', 'not an identifier'],
    ['a string holding the key', `prefix_${KEY}`],
  ])('drops a field that is %s', async (_name, value) => {
    const result = await post(respond(401, '{}'), () => ({
      type: value,
      code: value,
    }));
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'http', status: 401 },
    });
  });

  test('keeps a 64 character identifier', async () => {
    const value = 'a'.repeat(64);
    expect(await post(respond(400, '{}'), () => ({ type: value }))).toEqual({
      ok: false,
      failure: { kind: 'http', status: 400, errorType: value },
    });
  });

  test('a non-JSON error body gives the status alone without calling the extractor', async () => {
    let calls = 0;
    const result = await post(respond(502, 'Bad gateway'), () => {
      calls += 1;
      return { type: 'never' };
    });
    expect(calls).toBe(0);
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'http', status: 502 },
    });
  });

  test('an error body over 4 KB gives the status alone without calling the extractor', async () => {
    let calls = 0;
    const body = JSON.stringify({ type: 'too_long', pad: 'x'.repeat(8192) });
    const result = await post(respond(400, body), () => {
      calls += 1;
      return { type: 'too_long' };
    });
    expect(calls).toBe(0);
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'http', status: 400 },
    });
  });

  test('an extractor that throws gives the status alone', async () => {
    const result = await post(respond(500, '{}'), () => {
      throw new Error('unexpected shape');
    });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'http', status: 500 },
    });
  });

  test('a top-level type and code are not read unless the extractor reads them', async () => {
    const result = await post(
      respond(400, JSON.stringify({ type: 'bad_request', code: 'E1' })),
      () => ({}),
    );
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'http', status: 400 },
    });
  });
});
