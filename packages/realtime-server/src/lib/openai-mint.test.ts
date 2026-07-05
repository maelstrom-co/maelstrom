import { expect, it } from 'bun:test';
import { TokenHandshakeResponseSchema } from '@maelstrom-co/protocol';
import { createOpenAiMintHandler } from './openai-mint.js';

it('mints an ephemeral secret without leaking the api key', async () => {
  let sentAuth = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentAuth = (init.headers as Record<string, string>).Authorization;
    return new Response(
      JSON.stringify({ value: 'ek-xyz', expires_at: 1712345678, session: { id: 's' } }),
      { status: 200 },
    );
  };
  const handler = createOpenAiMintHandler({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const res = await handler(
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', sessionId: 'sess-1' }),
    }),
  );
  const body = await res.json();
  expect(TokenHandshakeResponseSchema.parse(body).value).toBe('ek-xyz');
  expect(sentAuth).toBe('Bearer sk-secret');
  expect(JSON.stringify(body)).not.toContain('sk-secret');
});

it('responds with a generic error and no key leakage when upstream rejects the request', async () => {
  const fakeFetch = async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  const handler = createOpenAiMintHandler({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const res = await handler(
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', sessionId: 'sess-1' }),
    }),
  );
  const body = await res.json();
  expect(res.ok).toBe(false);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(JSON.stringify(body)).not.toContain('sk-secret');
});

it('responds with a generic error and no key leakage when the upstream fetch throws', async () => {
  const fakeFetch = async (): Promise<Response> => {
    throw new Error('network down');
  };
  const handler = createOpenAiMintHandler({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const res = await handler(
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', sessionId: 'sess-1' }),
    }),
  );
  const body = await res.json();
  expect(res.ok).toBe(false);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(JSON.stringify(body)).not.toContain('sk-secret');
});
