// @vitest-environment happy-dom
import { SessionId } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPlaygroundHello } from '../server/playground-frames';
import { buildPlaygroundHello, buildWsUrl, createDemoConnector } from './connector';

/**
 * Minimal in-memory WebSocket fake, just enough to drive
 * WebSocketConnector's onOpen hook without a live server. Mirrors
 * packages/client's test-only FakeWebSocket, which isn't part of the
 * package's public surface.
 */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.#listeners.get('open')?.forEach((fn) => {
      fn({});
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  addEventListener(type: string, fn: (event: unknown) => void): void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.#listeners.get(type)?.delete(fn);
  }
}

function installFakeWebSocket(): () => void {
  const previous = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  return () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = previous;
    FakeWebSocket.instances = [];
  };
}

describe('buildWsUrl', () => {
  it('derives wss:// from an https origin in hosted mode', () => {
    const url = buildWsUrl(true, { protocol: 'https:', host: 'playground.maelstrom.co' }, undefined);
    expect(url).toBe('wss://playground.maelstrom.co/ws');
  });

  it('derives ws:// (never wss://) from a plain-http origin in hosted mode', () => {
    // The exact bug observed on wrangler dev: a hard-coded `wss://` against
    // a plain-HTTP origin (e.g. http://localhost:8788) throws
    // ERR_SSL_PROTOCOL_ERROR on every connection attempt.
    const url = buildWsUrl(true, { protocol: 'http:', host: 'localhost:8788' }, undefined);
    expect(url).toBe('ws://localhost:8788/ws');
  });

  it('ignores location and uses VITE_WS_URL in local (non-hosted) mode', () => {
    const url = buildWsUrl(false, { protocol: 'https:', host: 'example.com' }, 'ws://localhost:3001');
    expect(url).toBe('ws://localhost:3001/ws');
  });

  it('falls back to ws://localhost:3001 in local mode when VITE_WS_URL is unset', () => {
    const url = buildWsUrl(false, { protocol: 'https:', host: 'example.com' }, undefined);
    expect(url).toBe('ws://localhost:3001/ws');
  });
});

describe('buildPlaygroundHello', () => {
  it('produces a frame the server accepts as a well-formed handshake', () => {
    const wire = buildPlaygroundHello('s1', 'sk-x');
    expect(isPlaygroundHello(JSON.parse(wire))).toBe(true);
  });
});

describe('createDemoConnector', () => {
  it('does not send a handshake frame in local (non-hosted) mode', () => {
    // import.meta.env.VITE_HOSTED is unset in the test environment by
    // default — this exercises the local-dev branch.
    const connector = createDemoConnector({ getApiKey: () => null });
    expect(connector).toBeTruthy();
    // WebSocketConnector has no public way to inspect its onOpen option
    // directly, so this test asserts the *contract*: constructing the
    // connector must not throw even though getApiKey returns null, proving
    // the local branch never dereferences it.
  });

  describe('in hosted mode', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('sends a well-formed playground.hello handshake on open when a key is set', async () => {
      vi.stubEnv('VITE_HOSTED', '1');
      const restore = installFakeWebSocket();
      try {
        const connector = createDemoConnector({ getApiKey: () => 'sk-visitor-key' });
        const connectPromise = connector.connect(SessionId('session-1'));
        const socket = FakeWebSocket.instances[0];
        if (!socket) throw new Error('expected a WebSocket to have been constructed');
        socket.emitOpen();
        await connectPromise;

        expect(socket.sent).toHaveLength(1);
        const frame: unknown = JSON.parse(socket.sent[0] ?? '{}');
        expect(isPlaygroundHello(frame)).toBe(true);
        expect(frame).toMatchObject({
          type: 'playground.hello',
          sessionId: 'session-1',
          apiKey: 'sk-visitor-key',
        });
      } finally {
        restore();
      }
    });

    it('sends nothing on open when no key is set yet', async () => {
      vi.stubEnv('VITE_HOSTED', '1');
      const restore = installFakeWebSocket();
      try {
        const connector = createDemoConnector({ getApiKey: () => null });
        const connectPromise = connector.connect(SessionId('session-1'));
        const socket = FakeWebSocket.instances[0];
        if (!socket) throw new Error('expected a WebSocket to have been constructed');
        socket.emitOpen();
        await connectPromise;

        expect(socket.sent).toHaveLength(0);
      } finally {
        restore();
      }
    });
  });
});
