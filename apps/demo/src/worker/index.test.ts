import { describe, expect, it, vi } from 'vitest';

// @cloudflare/containers' own entrypoint imports the 'cloudflare:workers'
// virtual module, which only exists inside an actual Workers runtime -- not
// under plain vitest. Mocking the package (rather than only stubbing
// getContainer) is what lets this file import worker/index.ts at all.
// getContainerMock must be created via vi.hoisted: vitest hoists vi.mock
// factories above the rest of the module, so a plain outer `const` referenced
// from inside the factory would be read before its own initializer runs.
const { getContainerMock } = vi.hoisted(() => ({ getContainerMock: vi.fn() }));

vi.mock('@cloudflare/containers', () => ({
  Container: class {},
  getContainer: (...args: unknown[]) => getContainerMock(...args),
}));

const worker = (await import('./index')).default;

function makeEnv() {
  return {
    PLAYGROUND_SERVER: {},
    ASSETS: { fetch: async () => new Response('assets') },
  } as unknown as Parameters<typeof worker.fetch>[1];
}

describe('worker /ws upgrade guard (Fix 7)', () => {
  it('rejects a plain GET with 426 and never calls getContainer', async () => {
    // Container.fetch() calls startAndWaitForPorts() when the instance isn't
    // running and renewActivityTimeout() on every proxied request -- so an
    // unauthenticated GET with no Upgrade header would otherwise cold-start
    // an instance and keep it warm indefinitely, and the `session` query
    // param maps onto only 5 shard buckets, so all five can be pinned this
    // way.
    getContainerMock.mockClear();
    const request = new Request('https://example.com/ws');

    const response = await worker.fetch(request, makeEnv());

    expect(response.status).toBe(426);
    expect(getContainerMock).not.toHaveBeenCalled();
  });

  it('rejects a GET carrying unrelated headers but no Upgrade header', async () => {
    getContainerMock.mockClear();
    const request = new Request('https://example.com/ws?session=abc', {
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    });

    const response = await worker.fetch(request, makeEnv());

    expect(response.status).toBe(426);
    expect(getContainerMock).not.toHaveBeenCalled();
  });

  it('lets a request carrying a websocket Upgrade header through to getContainer, matched case-insensitively', async () => {
    // Proof the guard doesn't blanket-reject everything on /ws: a real
    // upgrade request (browsers send "websocket" lowercase; this checks a
    // differently-cased value isn't rejected either) must still reach the
    // container.
    getContainerMock.mockReturnValue({ fetch: async () => new Response('container reached') });
    getContainerMock.mockClear();
    const request = new Request('https://example.com/ws', {
      headers: { Upgrade: 'WebSocket' },
    });

    const response = await worker.fetch(request, makeEnv());

    expect(getContainerMock).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe('container reached');
  });

  it('does not apply the upgrade guard to non-/ws paths', async () => {
    getContainerMock.mockClear();
    const request = new Request('https://example.com/some-asset.js');

    const response = await worker.fetch(request, makeEnv());

    expect(await response.text()).toBe('assets');
    expect(getContainerMock).not.toHaveBeenCalled();
  });
});
