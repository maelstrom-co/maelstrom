import type { LiveExchangeRequest } from '@maelstrom-co/realtime-protocol/openai-live';
import { describe, expect, it, vi } from 'vitest';
import { createLocalLiveHandler } from '../server/live-session';
import { createLocalLiveAccess } from '../server/local-live-access';
import { createDemoLiveExchange, liveErrorMessage } from './live-exchange';

const offer: LiveExchangeRequest = {
  session: {
    model: 'gpt-live-1',
    delegation: { type: 'responses', responses: { model: 'gpt-5.4-mini' } },
  },
  transport: { type: 'webrtc', sdp: 'v=0\r\no=fixture-offer' },
};
const answer = {
  session: { id: 'fixture-session' },
  transport: { type: 'webrtc', sdp: 'v=0\r\no=fixture-answer' },
};
const signal = () => new AbortController().signal;
const password = 'fixture-local-password-not-a-provider-key';
const authorization = `Basic ${Buffer.from(`maelstrom:${password}`).toString('base64')}`;
const access = createLocalLiveAccess({
  enabled: true,
  hosted: false,
  password,
});
const authorize = (request: Request) =>
  access(request.headers, {
    localAddress: '127.0.0.1',
    remoteAddress: '127.0.0.1',
  });
const request = (body: unknown = offer, origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/live-session', {
    method: 'POST',
    headers: {
      origin,
      'sec-fetch-site': 'same-origin',
      'Content-Type': 'application/json',
      authorization,
    },
    body: JSON.stringify(body),
  });

describe('demo Live credential boundaries', () => {
  it('distinguishes local host authorization failures from upstream model access errors', async () => {
    const modelDenied = createDemoLiveExchange(
      undefined,
      vi.fn<typeof fetch>(async () =>
        Response.json({ error: 'safe error' }, { status: 403 }),
      ),
    );
    const modelError = await modelDenied(offer, signal()).catch(
      (error: unknown) => error,
    );
    expect(liveErrorMessage(modelError)).toContain('model');
    expect(modelError).toMatchObject({
      code: 'exchange_rejected',
      status: 403,
    });
    const hostDenied = createDemoLiveExchange(
      undefined,
      vi.fn<typeof fetch>(async () =>
        Response.json(
          { error: 'safe error' },
          { status: 403, headers: { 'X-Maelstrom-Live-Access': 'denied' } },
        ),
      ),
    );
    const hostError = await hostDenied(offer, signal()).catch(
      (error: unknown) => error,
    );
    expect(hostError).toMatchObject({ code: 'local_exchange_unavailable' });
    expect(liveErrorMessage(hostError)).toContain('DEMO_LOCAL_SERVER_KEY');
  });
  it('rejects a forged same-origin remote request before spending the server key', async () => {
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json(answer, { status: 201 }),
    );
    const forged = new Request(
      'https://forwarded-demo.example/api/live-session',
      {
        method: 'POST',
        headers: {
          origin: 'https://forwarded-demo.example',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify(offer),
      },
    );
    const response = await createLocalLiveHandler(
      'fixture-server-key',
      upstream,
    )(forged);
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('sends the visitor key only to the fixed OpenAI endpoint, once, with no redirects', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/live/sessions');
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer fixture-key',
      );
      expect(init?.body).not.toContain('fixture-key');
      return Response.json(answer, { status: 201 });
    });
    expect(
      await createDemoLiveExchange(() => 'fixture-key', fetcher)(
        offer,
        signal(),
      ),
    ).toEqual(answer);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses a keyless same-origin exchange for server-key startup', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe('/api/live-session');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return Response.json(answer, { status: 201 });
    });
    await createDemoLiveExchange(undefined, fetcher)(offer, signal());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    401, 403, 404, 429, 307, 500,
  ])('does not retry or expose upstream content after status %i', async (status) => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response('fixture-private-content', { status }),
    );
    const error = await createDemoLiveExchange(() => 'fixture-key', fetcher)(
      offer,
      signal(),
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ status, code: 'exchange_rejected' });
    expect(liveErrorMessage(error)).not.toContain('fixture-private-content');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    'not json',
    JSON.stringify({ session: {}, transport: {} }),
    'x'.repeat(131_073),
  ])('rejects malformed or oversized upstream answers', async (body) => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(body, { status: 201 }),
    );
    await expect(
      createDemoLiveExchange(() => 'fixture-key', fetcher)(offer, signal()),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fails missing visitor credentials before network activity', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createDemoLiveExchange(() => null, fetcher)(offer, signal()),
    ).rejects.toMatchObject({ code: 'missing_key' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps the local server key upstream and marks the answer uncacheable', async () => {
    const upstream = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer fixture-server-key',
      );
      expect(init?.redirect).toBe('error');
      return Response.json(answer, { status: 201 });
    });
    const response = await createLocalLiveHandler(
      'fixture-server-key',
      upstream,
      authorize,
    )(request());
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(answer);
  });
  it('rejects cross-origin use and unsupported model policy before spending the server key', async () => {
    const upstream = vi.fn<typeof fetch>();
    const handler = createLocalLiveHandler(
      'fixture-server-key',
      upstream,
      authorize,
    );
    expect(
      (await handler(request(offer, 'https://untrusted.invalid'))).status,
    ).toBe(403);
    expect(
      (
        await handler(
          request({
            ...offer,
            session: { ...offer.session, model: 'unapproved-model' },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          request({ ...offer, session: { ...offer.session, store: true } }),
        )
      ).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('maps malformed upstream and rejected keys to safe local errors without retry', async () => {
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json({ secret: 'fixture-server-key' }, { status: 201 }),
    );
    const response = await createLocalLiveHandler(
      'fixture-server-key',
      upstream,
      authorize,
    )(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('fixture-server-key');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('bounds reading an authenticated request body before making any upstream call', async () => {
    vi.useFakeTimers();
    const upstream = vi.fn<typeof fetch>();
    const cancel = vi.fn();
    const slow = new Request('http://localhost:3000/api/live-session', {
      method: 'POST',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
      },
      body: new ReadableStream({ cancel }),
      duplex: 'half',
    } as RequestInit);
    const result = createLocalLiveHandler(
      'fixture-server-key',
      upstream,
      authorize,
    )(slow);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).status).toBe(408);
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
