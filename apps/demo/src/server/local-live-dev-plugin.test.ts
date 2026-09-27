import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { expect, it, vi } from 'vitest';
import { localLiveDevPlugin } from '../../local-live-dev-plugin';

const password = 'fixture-local-password-not-a-provider-key';
const options = {
  enabled: true,
  hosted: false,
  password,
  apiKey: 'fixture-server-key',
};
const offer = {
  session: {
    model: 'gpt-live-1',
    delegation: { type: 'responses', responses: { model: 'gpt-6-luna' } },
  },
  transport: { type: 'webrtc', sdp: 'v=0\r\no=fixture' },
};

it('rejects a network bind override before exposing the server-key handler', async () => {
  await expect(
    createServer({
      configFile: false,
      server: { host: '0.0.0.0', port: 0 },
      plugins: [localLiveDevPlugin(options)],
    }),
  ).rejects.toThrow('loopback');
});

it('authenticates on the real loopback listener before parsing or spending a provider key', async () => {
  const upstream = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer fixture-server-key',
    );
    return Response.json(
      {
        session: { id: 'fixture-session' },
        transport: { type: 'webrtc', sdp: 'v=0\r\no=answer' },
      },
      { status: 201 },
    );
  });
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    ssr: {
      resolve: {
        conditions: [
          'module',
          'node',
          'development|production',
          '@maelstrom-co/source',
        ],
      },
    },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [localLiveDevPlugin({ ...options, fetch: upstream })],
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP listener');
    expect(address.address).toBe('127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = {
      origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    };
    const denied = await fetch(`${origin}/api/live-session`, {
      method: 'POST',
      headers,
      body: JSON.stringify(offer),
    });
    expect(denied.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    const response = await fetch(`${origin}/api/live-session`, {
      method: 'POST',
      headers: {
        ...headers,
        authorization: `Basic ${Buffer.from(`maelstrom:${password}`).toString('base64')}`,
      },
      body: JSON.stringify(offer),
    });
    expect(response.status).toBe(201);
    expect(await response.text()).not.toContain('fixture-server-key');
    expect(upstream).toHaveBeenCalledOnce();
  } finally {
    await server.close();
  }
});
