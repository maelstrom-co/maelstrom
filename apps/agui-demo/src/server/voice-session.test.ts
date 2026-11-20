import { expect, test } from 'bun:test';

import type {
  LiveExchangeRequest,
  LiveSessionExchange,
} from '@maelstrom-co/realtime-protocol/openai-live';

import { voiceTool } from '../voice-contract';
import { LocalWorkspaceHost } from './http-host';
import { VoiceSessions } from './voice-session';

const origin = 'http://127.0.0.1:4310';
const offer: LiveExchangeRequest = {
  transport: { type: 'webrtc', sdp: 'v=0\r\no=offer' },
  session: {
    model: 'untrusted-model',
    store: true,
    instructions: 'untrusted instructions',
    input: [
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'untrusted history' }],
      },
    ],
    delegation: {
      type: 'responses',
      responses: {
        model: 'untrusted-backend',
        tools: [{ type: 'web_search' }],
      },
    },
  },
};
const answer = {
  session: { id: 'live_test' },
  transport: { type: 'webrtc' as const, sdp: 'v=0\r\no=answer' },
};
function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function browser(host: LocalWorkspaceHost) {
  let cookie = '';
  let binding = '';
  return async (path: string, body: unknown, headers?: HeadersInit) => {
    const response = await host.fetch(
      new Request(`${origin}${path}`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          cookie,
          'x-workspace-binding': binding,
          'x-openai-key': 'test-provider-key',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    if (path.endsWith('/bootstrap') && response.ok)
      binding = (await response.clone().json()).bindingId ?? binding;
    return response;
  };
}

test('only the authorized binding can exchange voice and browser configuration cannot change the provider policy', async () => {
  const offers: LiveExchangeRequest[] = [];
  const host = new LocalWorkspaceHost(origin, {
    voiceExchange: (key) => async (input) => {
      expect(key).toBe('test-provider-key');
      offers.push(input);
      return answer;
    },
  });
  const request = browser(host);
  expect((await request('/api/workspace/voice', offer)).status).toBe(401);
  await request('/api/workspace/bootstrap', {});
  expect(
    (
      await request('/api/workspace/voice', offer, {
        origin: 'https://other.test',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request('/api/workspace/voice', offer, {
        'x-workspace-binding': 'other-binding',
      })
    ).status,
  ).toBe(409);
  expect(offers).toHaveLength(0);
  const response = await request('/api/workspace/voice', offer);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(answer);
  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({
    transport: offer.transport,
    session: {
      model: 'gpt-live-1',
      store: false,
      delegation: {
        responses: {
          model: 'gpt-6-luna',
          parallel_tool_calls: false,
          tools: [{ type: 'function', name: voiceTool.name }],
        },
      },
    },
  });
  expect(offers[0].session.delegation.responses.tools).toHaveLength(1);
  expect(JSON.stringify(offers[0])).not.toContain('untrusted');
  expect(JSON.stringify(offers[0])).not.toContain('test-provider-key');
});

test('failed voice exchange is single-attempt and leaves typed workspace work available', async () => {
  let attempts = 0;
  const request = browser(
    new LocalWorkspaceHost(origin, {
      voiceExchange: () => async () => {
        attempts++;
        throw new Error('Provider unavailable');
      },
    }),
  );
  await request('/api/workspace/bootstrap', {});
  expect((await request('/api/workspace/voice', offer)).status).toBe(502);
  expect(attempts).toBe(1);
  expect((await request('/api/workspace/records', {})).status).toBe(200);
});

test('reconciliation discards a late voice answer without retiring the fresh binding', async () => {
  const entered = latch<AbortSignal>();
  const release = latch<void>();
  const exchange: LiveSessionExchange = async (_input, signal) => {
    entered.resolve(signal);
    await release.promise;
    return answer;
  };
  const request = browser(
    new LocalWorkspaceHost(origin, { voiceExchange: () => exchange }),
  );
  await request('/api/workspace/bootstrap', {});
  const old = request('/api/workspace/voice', offer);
  const signal = await entered.promise;
  await request('/api/workspace/bootstrap', { reconcile: true });
  expect(signal.aborted).toBe(true);
  release.resolve();
  expect((await old).status).toBe(502);
  expect((await request('/api/workspace/records', {})).status).toBe(200);
});

test('voice rejects concurrent exchanges and retains its connection budget after provider failures', async () => {
  const entered = latch<void>();
  const release = latch<void>();
  let attempts = 0;
  const sessions = new VoiceSessions(() => async () => {
    attempts++;
    entered.resolve();
    await release.promise;
    throw new Error('Provider failed');
  });
  const signal = new AbortController().signal;
  const first = sessions.exchange(offer, 'test-key', signal);
  void first.catch(() => {});
  await entered.promise;
  await expect(sessions.exchange(offer, 'test-key', signal)).rejects.toThrow(
    'budget',
  );
  release.resolve();
  await expect(first).rejects.toThrow('Provider failed');
  for (let index = 1; index < 10; index++)
    await expect(sessions.exchange(offer, 'test-key', signal)).rejects.toThrow(
      'Provider failed',
    );
  await expect(sessions.exchange(offer, 'test-key', signal)).rejects.toThrow(
    'budget',
  );
  expect(attempts).toBe(10);
});
