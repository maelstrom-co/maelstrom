// @vitest-environment happy-dom
import { SessionId } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPlaygroundHello } from '../server/playground-frames';
import {
  buildPlaygroundHello,
  buildWsUrl,
  createDemoConnector,
} from './connector';

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
    const url = buildWsUrl(
      true,
      { protocol: 'https:', host: 'playground.maelstrom.co' },
      undefined,
    );
    expect(url).toBe('wss://playground.maelstrom.co/ws');
  });

  it('derives ws:// (never wss://) from a plain-http origin in hosted mode', () => {
    // The exact bug observed on wrangler dev: a hard-coded `wss://` against
    // a plain-HTTP origin (e.g. http://localhost:8788) throws
    // ERR_SSL_PROTOCOL_ERROR on every connection attempt.
    const url = buildWsUrl(
      true,
      { protocol: 'http:', host: 'localhost:8788' },
      undefined,
    );
    expect(url).toBe('ws://localhost:8788/ws');
  });

  it('ignores location and uses VITE_WS_URL in local (non-hosted) mode', () => {
    const url = buildWsUrl(
      false,
      { protocol: 'https:', host: 'example.com' },
      'ws://localhost:3001',
    );
    expect(url).toBe('ws://localhost:3001/ws');
  });

  it('falls back to ws://localhost:3001 in local mode when VITE_WS_URL is unset', () => {
    const url = buildWsUrl(
      false,
      { protocol: 'https:', host: 'example.com' },
      undefined,
    );
    expect(url).toBe('ws://localhost:3001/ws');
  });

  it('appends a session query param in hosted mode when one is given', () => {
    // worker/index.ts reads this off the /ws request and passes it straight
    // to idFromName(session) — the session id IS the Durable Object id, so
    // this query param is what pins a connection to the same object across
    // reconnects.
    const url = buildWsUrl(
      true,
      { protocol: 'https:', host: 'playground.maelstrom.co' },
      undefined,
      'session-abc123',
    );
    expect(url).toBe('wss://playground.maelstrom.co/ws?session=session-abc123');
  });

  it('omits the session query param entirely when none is given', () => {
    const url = buildWsUrl(
      true,
      { protocol: 'https:', host: 'playground.maelstrom.co' },
      undefined,
    );
    expect(url).toBe('wss://playground.maelstrom.co/ws');
  });

  it('never appends a session query param in local (non-hosted) mode', () => {
    // No Worker sits in front of local dev's ws-server.ts, so there is no
    // Durable Object identity to select -- the session param would have
    // nowhere to route to.
    const url = buildWsUrl(
      false,
      { protocol: 'https:', host: 'example.com' },
      'ws://localhost:3001',
      'session-abc123',
    );
    expect(url).toBe('ws://localhost:3001/ws');
  });

  it('percent-encodes a session value that needs it', () => {
    const url = buildWsUrl(
      true,
      { protocol: 'https:', host: 'playground.maelstrom.co' },
      undefined,
      'has space&amp',
    );
    expect(url).toBe(
      'wss://playground.maelstrom.co/ws?session=has%20space%26amp',
    );
  });
});

describe('buildPlaygroundHello', () => {
  it('produces a frame the server accepts as a well-formed handshake', () => {
    // The key must clear isPlaygroundHello's minimum-length floor: a short
    // key would be rejected by the gate, so a fixture under it would assert
    // the handshake is malformed rather than that buildPlaygroundHello and
    // the server agree on the frame shape.
    const wire = buildPlaygroundHello('s1', 'sk-x-1234567890123456');
    expect(isPlaygroundHello(JSON.parse(wire))).toBe(true);
  });
});

describe('createDemoConnector', () => {
  // Local dev's ws-server has no hello gate, so a stray handshake frame
  // would reach handleEnvelope and be answered as a malformed request. The
  // key must not leave the browser here either — local mode mints from the
  // server's own env. import.meta.env.VITE_HOSTED is unset by default in
  // the test environment, so this exercises the local-dev branch.
  it('does not send a handshake frame in local (non-hosted) mode', async () => {
    const restore = installFakeWebSocket();
    try {
      const connector = createDemoConnector({
        getApiKey: () => 'sk-visitor-key-1234567',
      });
      const connectPromise = connector.connect(SessionId('session-1'));
      const socket = FakeWebSocket.instances[0];
      if (!socket)
        throw new Error('expected a WebSocket to have been constructed');
      socket.emitOpen();
      await connectPromise;

      expect(socket.sent).toHaveLength(0);
    } finally {
      restore();
    }
  });

  describe('in hosted mode', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('sends a well-formed playground.hello handshake on open when a key is set', async () => {
      vi.stubEnv('VITE_HOSTED', '1');
      const restore = installFakeWebSocket();
      try {
        const connector = createDemoConnector({
          getApiKey: () => 'sk-visitor-key-1234567',
        });
        const connectPromise = connector.connect(SessionId('session-1'));
        const socket = FakeWebSocket.instances[0];
        if (!socket)
          throw new Error('expected a WebSocket to have been constructed');
        socket.emitOpen();
        await connectPromise;

        expect(socket.sent).toHaveLength(1);
        const frame: unknown = JSON.parse(socket.sent[0] ?? '{}');
        expect(isPlaygroundHello(frame)).toBe(true);
        expect(frame).toMatchObject({
          type: 'playground.hello',
          sessionId: 'session-1',
          apiKey: 'sk-visitor-key-1234567',
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
        if (!socket)
          throw new Error('expected a WebSocket to have been constructed');
        socket.emitOpen();
        await connectPromise;

        expect(socket.sent).toHaveLength(0);
      } finally {
        restore();
      }
    });

    // The id the connector sends as the /ws session param must be the exact
    // id the caller handed it, or a reconnect resolves idFromName() to a
    // DIFFERENT Durable Object that has never seen this session and the
    // conversation history is silently gone.
    it('routes on the very session id it was given, not a separate one', async () => {
      vi.stubEnv('VITE_HOSTED', '1');
      const restore = installFakeWebSocket();
      try {
        const connector = createDemoConnector({
          sessionId: SessionId('session-1'),
          getApiKey: () => null,
        });
        const connectPromise = connector.connect(SessionId('session-1'));
        const socket = FakeWebSocket.instances[0];
        if (!socket)
          throw new Error('expected a WebSocket to have been constructed');
        socket.emitOpen();
        await connectPromise;

        expect(socket.url).toContain('?session=session-1');
      } finally {
        restore();
      }
    });

    it('answers a playground.rehello frame carrying extra fields by resending the handshake', async () => {
      // Matches on the parsed `type` discriminant, not the frame's exact
      // serialized text -- a frame carrying fields SessionDO doesn't emit
      // today (a reason code, a session id) must still be recognized, or a
      // visitor's session would silently never recover from hibernation.
      vi.stubEnv('VITE_HOSTED', '1');
      const restore = installFakeWebSocket();
      try {
        const connector = createDemoConnector({
          getApiKey: () => 'sk-visitor-key-1234567',
        });
        const connectPromise = connector.connect(SessionId('session-1'));
        const socket = FakeWebSocket.instances[0];
        if (!socket)
          throw new Error('expected a WebSocket to have been constructed');
        socket.emitOpen();
        await connectPromise;
        socket.sent.length = 0;

        socket.onmessage?.({
          data: JSON.stringify({
            type: 'playground.rehello',
            reason: 'hibernated',
          }),
        });

        expect(socket.sent).toHaveLength(1);
        expect(isPlaygroundHello(JSON.parse(socket.sent[0] ?? '{}'))).toBe(
          true,
        );
      } finally {
        restore();
      }
    });

    it('does not throw on a malformed (non-JSON) frame, and does not resend the handshake for it', async () => {
      vi.stubEnv('VITE_HOSTED', '1');
      const restore = installFakeWebSocket();
      try {
        const connector = createDemoConnector({
          getApiKey: () => 'sk-visitor-key-1234567',
        });
        const connectPromise = connector.connect(SessionId('session-1'));
        const socket = FakeWebSocket.instances[0];
        if (!socket)
          throw new Error('expected a WebSocket to have been constructed');
        socket.emitOpen();
        await connectPromise;
        socket.sent.length = 0;

        expect(() => {
          socket.onmessage?.({ data: 'not json' });
        }).not.toThrow();
        expect(socket.sent).toHaveLength(0);
      } finally {
        restore();
      }
    });

    it('reuses the same socket URL (and therefore the same session query param) across a reconnect', async () => {
      // The whole point of pinning session identity to object identity: a
      // connector that reconnects must keep landing on the same Durable
      // Object, which only holds if repeated connect() calls on one
      // connector instance open the same URL.
      vi.stubEnv('VITE_HOSTED', '1');
      const restore = installFakeWebSocket();
      try {
        const connector = createDemoConnector({ getApiKey: () => null });

        // Resolved eagerly rather than with `?.` on each use: if a socket is
        // never constructed, an optional call would silently no-op and leave
        // the connect() promise pending forever, so the test would time out
        // instead of reporting what actually went wrong.
        const firstConnect = connector.connect(SessionId('session-1'));
        const firstSocket = FakeWebSocket.instances[0];
        if (!firstSocket)
          throw new Error('expected a WebSocket to have been constructed');
        firstSocket.emitOpen();
        await firstConnect;
        const firstUrl = firstSocket.url;

        const secondConnect = connector.connect(SessionId('session-1'));
        const secondSocket = FakeWebSocket.instances[1];
        if (!secondSocket)
          throw new Error('expected a second WebSocket on reconnect');
        secondSocket.emitOpen();
        await secondConnect;
        const secondUrl = secondSocket.url;

        expect(secondUrl).toBe(firstUrl);
      } finally {
        restore();
      }
    });
  });
});
