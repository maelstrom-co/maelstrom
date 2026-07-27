import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  MessageId,
  type SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';

import { HttpConnector } from '../http-connector.js';

type FetchMock = (input: string, init?: RequestInit) => Promise<Response>;

let originalFetch: typeof globalThis.fetch;
let lastCall: {
  url: string;
  method: string | undefined;
  body: unknown;
} | null = null;

const installFetch = (impl: FetchMock): void => {
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    lastCall = {
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    return impl(url, init);
  }) as typeof globalThis.fetch;
};

beforeEach(() => {
  originalFetch = globalThis.fetch;
  lastCall = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('HttpConnector.getHistory', () => {
  test('POSTs /history with { sessionId } and returns the parsed entries', async () => {
    const expected: SessionHistoryEntry[] = [
      {
        kind: 'turn',
        id: MessageId('m-1'),
        sessionId: SessionId('persisted'),
        timestamp: 1700000000000,
        userIntent: 'show me the calendar',
        assistantMessage: 'Here is your calendar.',
      },
    ];
    installFetch(
      async () =>
        new Response(JSON.stringify(expected), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com' });
    const result = await connector.getHistory(SessionId('persisted'));

    expect(result).toEqual(expected);
    expect(lastCall?.url).toBe('https://api.example.com/history');
    expect(lastCall?.method).toBe('POST');
    expect(lastCall?.body).toEqual({ sessionId: 'persisted' });
  });

  test('throws on non-OK responses', async () => {
    installFetch(async () => new Response('boom', { status: 500 }));

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com' });
    await expect(connector.getHistory(SessionId('s-1'))).rejects.toThrow(
      /HTTP 500/,
    );
  });

  test('rejects with a useful timeout error when fetch hangs past the configured timeout', async () => {
    installFetch(
      (_url, init) =>
        new Promise((_, reject) => {
          // Hang until the connector's AbortController fires; reject with the
          // browser-style abort so the connector can replace it with the
          // timeout-aware message.
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const connector = new HttpConnector({
      baseUrl: 'https://api.example.com',
      timeout: 10,
    });
    await expect(connector.getHistory(SessionId('s-1'))).rejects.toThrow(
      /timed out after 10ms/,
    );
  });

  test('rejects when the server returns a malformed history payload', async () => {
    installFetch(
      async () =>
        new Response(JSON.stringify({ not: 'an array' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const connector = new HttpConnector({ baseUrl: 'https://api.example.com' });
    await expect(connector.getHistory(SessionId('s-1'))).rejects.toThrow(
      /malformed payload/i,
    );
  });
});
