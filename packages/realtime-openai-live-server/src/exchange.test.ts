import { describe, expect, test } from 'bun:test';
import type { LiveExchangeRequest } from '@maelstrom-co/realtime-protocol/openai-live';
import { createLiveSessionExchange } from './index.js';

const offer: LiveExchangeRequest = {
  session: {
    model: 'gpt-live-1',
    delegation: { type: 'responses', responses: { model: 'backend' } },
  },
  transport: { type: 'webrtc', sdp: 'v=0\r\no=offer' },
};
const answer = {
  session: { id: 'live_opaque/unchanged' },
  transport: { type: 'webrtc', sdp: 'v=0\r\no=answer' },
} as const;
const signal = () => new AbortController().signal;
function exchangeWith(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  timeoutMs = 100,
) {
  return createLiveSessionExchange({
    apiKey: 'test-only-secret',
    fetch: fetcher as typeof fetch,
    timeoutMs,
  });
}
describe('paid session boundary', () => {
  test('sends exactly one redirect-rejecting request and preserves opaque identity', async () => {
    let calls = 0;
    const exchange = exchangeWith(async (url, init) => {
      calls++;
      expect(url).toBe('https://api.openai.com/v1/live/sessions');
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      expect(JSON.parse(String(init?.body))).toEqual(offer);
      return Response.json(answer, { status: 201 });
    });
    expect(await exchange(offer, signal())).toEqual(answer);
    expect(calls).toBe(1);
  });
  test.each([
    {},
    { ...offer, apiKey: 'must-not-forward' },
    { ...offer, transport: { type: 'webrtc', sdp: '' } },
    { ...offer, session: { ...offer.session, delegation: null } },
  ])('invalid input cannot create a billed session: %j', async (input) => {
    let calls = 0;
    const exchange = exchangeWith(async () => {
      calls++;
      return Response.json(answer, { status: 201 });
    });
    await expect(
      exchange(input as LiveExchangeRequest, signal()),
    ).rejects.toMatchObject({ code: 'invalid_offer' });
    expect(calls).toBe(0);
  });
  test.each([
    301, 307, 400, 401, 429, 500, 200,
  ])('does not retry or accept upstream status %i', async (status) => {
    let calls = 0;
    const exchange = exchangeWith(async () => {
      calls++;
      return new Response('secret-bearing upstream body', {
        status,
        headers: {
          Location: 'https://elsewhere.invalid',
          'x-request-id': 'req_1',
        },
      });
    });
    await expect(exchange(offer, signal())).rejects.toMatchObject({
      code: 'exchange_rejected',
      status,
      requestId: 'req_1',
    });
    expect(calls).toBe(1);
  });
  test.each([
    {},
    { ...answer, session: { id: '' } },
    { ...answer, transport: { type: 'websocket', sdp: 'v=0\n' } },
    { ...answer, transport: { type: 'webrtc', sdp: 'bad' } },
  ])('rejects unusable answers: %j', async (body) => {
    await expect(
      exchangeWith(async () => Response.json(body, { status: 201 }))(
        offer,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'invalid_answer' });
  });
  test('aborted caller never sends and hanging fetch settles within its bound', async () => {
    let calls = 0;
    const exchange = exchangeWith(() => {
      calls++;
      return new Promise(() => {});
    }, 10);
    const abort = new AbortController();
    abort.abort();
    await expect(exchange(offer, abort.signal)).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(calls).toBe(0);
    await expect(exchange(offer, signal())).rejects.toMatchObject({
      code: 'exchange_timeout',
    });
    expect(calls).toBe(1);
  });
  test('body stalls and oversized bodies cannot retain the exchange indefinitely', async () => {
    const exchange = exchangeWith(
      async () =>
        new Response(new ReadableStream({ start() {} }), { status: 201 }),
      10,
    );
    await expect(exchange(offer, signal())).rejects.toMatchObject({
      code: 'exchange_timeout',
    });
    await expect(
      exchangeWith(
        async () => new Response('x'.repeat(131_073), { status: 201 }),
      )(offer, signal()),
    ).rejects.toMatchObject({ code: 'answer_too_large' });
  });
  test('untrusted fetch exceptions cannot leak provider keys through errors', async () => {
    await expect(
      exchangeWith(async () => {
        throw new Error('test-only-secret');
      })(offer, signal()),
    ).rejects.toMatchObject({ message: 'Live transport: exchange_failed' });
  });
});
