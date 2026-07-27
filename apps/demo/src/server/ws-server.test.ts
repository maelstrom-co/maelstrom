import {
  AssistantInjectionMessage,
  decodeServerEnvelope,
  encodeEnvelope,
  HistoryGetMessage,
  isOk,
  SessionId,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { describe, expect, it } from 'vitest';
import { SessionEngineManager } from './session-engine-manager';
import { createWebSocketHandlers, truncateCloseReason, type SocketData } from './ws-server';

// Same minimal real-shaped fixture as session-engine-manager.test.ts:
// createEngine's zod validator requires kind/name/model plus callable
// chatStream/structuredOutput, and neither an assistant_message injection nor
// a client.history.get ever calls them — so a fake that's never actually
// invoked is sufficient here.
const fakeAdapter = {
  kind: 'text',
  name: 'fake',
  model: 'fake-model',
  chatStream: () => {},
  structuredOutput: () => {},
} as unknown as AnyTextAdapter;

function makeSessionEngines(overrides: Partial<{ maxSessions: number }> = {}) {
  return new SessionEngineManager({
    maxSessions: overrides.maxSessions ?? 50,
    idleTtlMs: 30 * 60 * 1000,
    systemRules: 'test rules',
    createAdapter: () => fakeAdapter,
  });
}

/** Minimal stand-in for Bun.ServerWebSocket<SocketData> — only what the handlers touch. */
function makeFakeWs() {
  const sent: string[] = [];
  let closedWith: { code: number; reason: string } | null = null;
  return {
    data: {
      engine: null,
      helloReceived: false,
      sessionId: null,
      apiKey: null,
    } as SocketData,
    sent,
    get closedWith() {
      return closedWith;
    },
    send(data: string) {
      sent.push(data);
    },
    close(code: number, reason: string) {
      closedWith = { code, reason };
    },
  };
}

const hello = (sessionId: string, apiKey: string) =>
  JSON.stringify({ type: 'playground.hello', sessionId, apiKey });

describe('createWebSocketHandlers close handler (Finding A)', () => {
  it('does not evict the session engine on close — conversation history survives a socket close and reconnect on the same sessionId', async () => {
    const sessionEngines = makeSessionEngines();
    const handlers = createWebSocketHandlers({
      hosted: true,
      sessionEngines,
      sharedEngine: null,
      sharedEngineInitError: null,
    });

    // First connection: handshake, then seed conversation history with an
    // assistant_message injection (no LLM call — a pure history-store write).
    const wsA = makeFakeWs();
    await handlers.message(
      wsA as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-1', 'sk-test'),
    );
    expect(sessionEngines.has('sess-1')).toBe(true);
    const engineAfterHello = wsA.data.engine;

    await handlers.message(
      wsA as unknown as Parameters<typeof handlers.message>[0],
      encodeEnvelope(
        AssistantInjectionMessage({
          sessionId: SessionId('sess-1'),
          content: 'seeded note',
        }),
      ),
    );

    // Simulate an unclean close (a Cloudflare proxy drop, container restart —
    // anything that isn't the client's own code-1000 disconnect). Before the
    // fix, this called sessionEngines.evict('sess-1').
    handlers.close?.(
      wsA as unknown as Parameters<NonNullable<typeof handlers.close>>[0],
      1006,
      '',
    );

    expect(sessionEngines.has('sess-1')).toBe(true);

    // Reconnect: a new socket, same sessionId + apiKey (exactly what
    // WebSocketConnector's auto-reconnect does).
    const wsB = makeFakeWs();
    await handlers.message(
      wsB as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-1', 'sk-test'),
    );

    // Same engine instance — not a fresh one built from scratch.
    expect(wsB.data.engine).toBe(engineAfterHello);

    // And the history recorded before the close is still there.
    await handlers.message(
      wsB as unknown as Parameters<typeof handlers.message>[0],
      encodeEnvelope(HistoryGetMessage({ sessionId: SessionId('sess-1') })),
    );
    expect(wsB.sent).toHaveLength(1);
    const decoded = decodeServerEnvelope(wsB.sent[0]);
    expect(isOk(decoded)).toBe(true);
    if (!isOk(decoded)) throw new Error('expected a decodable server envelope');
    expect(decoded.value.type).toBe('engine.history.response');
    if (decoded.value.type !== 'engine.history.response') throw new Error('unreachable');
    expect(decoded.value.entries).toContainEqual(
      expect.objectContaining({ kind: 'injection', content: 'seeded note' }),
    );

    sessionEngines.dispose();
  });

  it('is a no-op when there is no session (local mode / never said hello) — does not throw', () => {
    const handlers = createWebSocketHandlers({
      hosted: false,
      sessionEngines: null,
      sharedEngine: null,
      sharedEngineInitError: null,
    });
    const ws = makeFakeWs();
    expect(() =>
      handlers.close?.(
        ws as unknown as Parameters<NonNullable<typeof handlers.close>>[0],
        1001,
        'going away',
      ),
    ).not.toThrow();
  });
});

describe('truncateCloseReason (Finding #1)', () => {
  it('cuts a multibyte string on a valid UTF-8 character boundary, never mid-character', () => {
    // An em dash is 3 UTF-8 bytes; placed so the 123-byte RFC 6455 cap lands
    // inside it. A naive code-unit slice(0, 123) keeps the dash's first two
    // bytes without its third -- invalid UTF-8, which is exactly what makes
    // Bun report close code 1003 instead of the caller's actual code.
    const message = `${'a'.repeat(121)}—${'b'.repeat(10)}`;
    const truncated = truncateCloseReason(message);
    const bytes = new TextEncoder().encode(truncated);
    expect(bytes.length).toBeLessThanOrEqual(123);
    // A fatal decoder throws on a boundary landing mid-character instead of
    // silently emitting a U+FFFD replacement -- round-tripping through it
    // proves the cut point is valid.
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
    expect(truncated).toBe('a'.repeat(121));
  });

  it('returns the input unchanged when it already fits within the byte cap', () => {
    expect(truncateCloseReason('short reason')).toBe('short reason');
  });
});

describe('createWebSocketHandlers hello-handler catch (Finding #1 integration)', () => {
  it('truncates an oversized construction-failure message to a valid UTF-8 boundary before closing 1011', async () => {
    const longMessage = `${'x'.repeat(121)}—${'y'.repeat(10)}`;
    const sessionEngines = new SessionEngineManager({
      maxSessions: 50,
      idleTtlMs: 30 * 60 * 1000,
      systemRules: 'test rules',
      createAdapter: () => {
        throw new Error(longMessage);
      },
    });
    const handlers = createWebSocketHandlers({
      hosted: true,
      sessionEngines,
      sharedEngine: null,
      sharedEngineInitError: null,
    });

    const ws = makeFakeWs();
    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-x', 'sk-x'),
    );

    expect(ws.closedWith?.code).toBe(1011);
    const reasonBytes = new TextEncoder().encode(ws.closedWith?.reason ?? '');
    expect(reasonBytes.length).toBeLessThanOrEqual(123);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(reasonBytes)).not.toThrow();

    sessionEngines.dispose();
  });
});

describe('createWebSocketHandlers capacity eviction close (Finding B/C server side)', () => {
  it('closes an evicted session with a clear capacity message on code 1008', async () => {
    // maxSessions: 1 forces the second hello to LRU-evict the first.
    const sessionEngines = makeSessionEngines({ maxSessions: 1 });
    const handlers = createWebSocketHandlers({
      hosted: true,
      sessionEngines,
      sharedEngine: null,
      sharedEngineInitError: null,
    });

    const wsA = makeFakeWs();
    await handlers.message(
      wsA as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-a', 'sk-a'),
    );
    expect(sessionEngines.has('sess-a')).toBe(true);

    const wsB = makeFakeWs();
    await handlers.message(
      wsB as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-b', 'sk-b'),
    );
    // sess-a was the LRU victim.
    expect(sessionEngines.has('sess-a')).toBe(false);

    // sess-a's socket is still open and sends its next frame — this is the
    // point where ws-server used to only say 'session evicted'.
    await handlers.message(
      wsA as unknown as Parameters<typeof handlers.message>[0],
      encodeEnvelope(HistoryGetMessage({ sessionId: SessionId('sess-a') })),
    );

    // 1008 specifically: the client treats it as non-retryable, which is
    // what stops evicted sessions from reconnecting straight back in and
    // evicting each other in turn. The reason is user-facing copy, so it
    // must tell the visitor what to actually do rather than name the
    // server's internal eviction.
    expect(wsA.closedWith?.code).toBe(1008);
    expect(wsA.closedWith?.reason).toMatch(/capacity/i);
    expect(wsA.closedWith?.reason).toMatch(/reload/i);

    sessionEngines.dispose();
  });

  // 1008 is the client's "never retry this" signal, so it has to stay
  // reserved for closes a reconnect genuinely cannot fix. A garbled first
  // frame is not one of those: the reconnecting socket sends its handshake
  // again and would succeed. Using 1008 here would strand the visitor on a
  // transient fault with the circuit breaker open.
  it('rejects an undecodable pre-hello frame with a retryable code, not the terminal 1008', async () => {
    const sessionEngines = makeSessionEngines();
    const handlers = createWebSocketHandlers({
      hosted: true,
      sessionEngines,
      sharedEngine: null,
      sharedEngineInitError: null,
    });

    const ws = makeFakeWs();
    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      JSON.stringify({ type: 'not-a-protocol-envelope' }),
    );

    expect(ws.closedWith?.code).toBe(1002);
    expect(ws.closedWith?.code).not.toBe(1008);

    sessionEngines.dispose();
  });
});
