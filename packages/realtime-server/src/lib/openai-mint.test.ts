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

it('rejects a provider other than openai with a 400', async () => {
  const fakeFetch = async (): Promise<Response> => {
    throw new Error('should not be called');
  };
  const handler = createOpenAiMintHandler({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const res = await handler(
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      body: JSON.stringify({ provider: 'google', sessionId: 'sess-1' }),
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(400);
  expect(typeof (body as { error: unknown }).error).toBe('string');
});

it('honors a model override in the request, in both the upstream call and the response', async () => {
  let sentBody = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentBody = init.body as string;
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
      body: JSON.stringify({ provider: 'openai', sessionId: 'sess-1', model: 'gpt-realtime-override' }),
    }),
  );
  const body = await res.json();
  expect(JSON.parse(sentBody).session.model).toBe('gpt-realtime-override');
  expect(TokenHandshakeResponseSchema.parse(body).model).toBe('gpt-realtime-override');
});

it('falls back to the server-configured model when no override is provided', async () => {
  let sentBody = '';
  const fakeFetch = async (_url: string, init: RequestInit) => {
    sentBody = init.body as string;
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
  expect(JSON.parse(sentBody).session.model).toBe('gpt-realtime-1.5');
  expect(TokenHandshakeResponseSchema.parse(body).model).toBe('gpt-realtime-1.5');
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

it('rejects a malformed JSON body with a 400 and never calls upstream fetch', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const handler = createOpenAiMintHandler({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const res = await handler(
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      body: '{not valid json',
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(400);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(fetchCalled).toBe(false);
});

it('rejects a structurally invalid handshake with a 400 and never calls upstream fetch', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const handler = createOpenAiMintHandler({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const res = await handler(
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai' }),
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(400);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(fetchCalled).toBe(false);
});

it('rejects a handshake with a wrong-typed provider with a 400 and never calls upstream fetch', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const handler = createOpenAiMintHandler({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const res = await handler(
    new Request('http://x/api/realtime/token', {
      method: 'POST',
      body: JSON.stringify({ provider: 123, sessionId: 'sess-1' }),
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(400);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(fetchCalled).toBe(false);
});

it('returns 500 and never calls upstream fetch when the handler holds no api key', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const handler = createOpenAiMintHandler({
    apiKey: '',
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
  expect(res.status).toBe(500);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(fetchCalled).toBe(false);
});

it('rejects a non-POST method with a 400 and never calls upstream fetch', async () => {
  let fetchCalled = false;
  const fakeFetch = async (): Promise<Response> => {
    fetchCalled = true;
    throw new Error('should not be called');
  };
  const handler = createOpenAiMintHandler({
    apiKey: 'sk-secret',
    model: 'gpt-realtime-1.5',
    fetch: fakeFetch,
  });
  const res = await handler(new Request('http://x/api/realtime/token', { method: 'GET' }));
  const body = await res.json();
  expect(res.status).toBe(400);
  expect(typeof (body as { error: unknown }).error).toBe('string');
  expect(fetchCalled).toBe(false);
});
