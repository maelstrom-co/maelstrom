import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '@maelstrom-co/client';
import {
  AssistantInjectionMessage,
  decodeServerEnvelope,
  encodeEnvelope,
  HistoryGetMessage,
  isOk,
  SessionId,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { describe, expect, it, vi } from 'vitest';
import { SessionEngineManager } from './session-engine-manager';
import {
  createWebSocketHandlers,
  type SocketData,
  truncateCloseReason,
} from './ws-server';

// ws-server.ts's production heartbeatIntervalMs is this same constant, so
// the liveness window below (2x) matches what actually runs.
const LIVENESS_WINDOW_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * 2;

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

function makeSessionEngines(
  overrides: Partial<{
    maxSessions: number;
    idleTtlMs: number;
    heartbeatIntervalMs: number;
  }> = {},
) {
  return new SessionEngineManager({
    maxSessions: overrides.maxSessions ?? 50,
    idleTtlMs: overrides.idleTtlMs ?? 30 * 60 * 1000,
    heartbeatIntervalMs:
      overrides.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
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

// >=20 chars each — clears the hello-gate's minimum apiKey length (Fix 4) so
// these frames reach classifyIncomingFrame as 'hello', not 'hello-rejected'.
const hello = (sessionId: string, apiKey: string) =>
  JSON.stringify({ type: 'playground.hello', sessionId, apiKey });

const KEY_A = 'sk-a-1234567890123456';
const KEY_B = 'sk-b-1234567890123456';
const KEY_X = 'sk-x-1234567890123456';

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
      hello('sess-1', KEY_A),
    );
    expect(sessionEngines.has('sess-1')).toBe(true);

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
      hello('sess-1', KEY_A),
    );

    // The history recorded before the close is still there — proof the
    // session's engine (and its conversation history) survived the close,
    // not just that *some* engine got built fresh.
    await handlers.message(
      wsB as unknown as Parameters<typeof handlers.message>[0],
      encodeEnvelope(HistoryGetMessage({ sessionId: SessionId('sess-1') })),
    );
    expect(wsB.sent).toHaveLength(1);
    const decoded = decodeServerEnvelope(wsB.sent[0]);
    expect(isOk(decoded)).toBe(true);
    if (!isOk(decoded)) throw new Error('expected a decodable server envelope');
    expect(decoded.value.type).toBe('engine.history.response');
    if (decoded.value.type !== 'engine.history.response')
      throw new Error('unreachable');
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
    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ).not.toThrow();
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
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
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
      hello('sess-x', KEY_X),
    );

    expect(ws.closedWith?.code).toBe(1011);
    const reasonBytes = new TextEncoder().encode(ws.closedWith?.reason ?? '');
    expect(reasonBytes.length).toBeLessThanOrEqual(123);
    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(reasonBytes),
    ).not.toThrow();

    sessionEngines.dispose();
  });
});

describe('createWebSocketHandlers dispatch re-derives the engine from the registry (Fix 1)', () => {
  it('an evicted session dispatching a frame gets a working engine and is NOT closed', async () => {
    vi.useFakeTimers();
    try {
      // maxSessions: 1 forces the second hello to LRU-evict the first, and
      // then dispatching sess-a's own next frame to LRU-evict sess-b in
      // turn. Each session is pushed past the liveness window before the
      // next getOrCreate that needs to reclaim it -- otherwise a still-live
      // session would now be refused with SessionCapacityError instead of
      // silently evicted (that refusal is exactly the fix this file also
      // covers separately; this test is about the *other* branch, a
      // genuinely stale session rebuilding without a close).
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
        hello('sess-a', KEY_A),
      );
      expect(sessionEngines.has('sess-a')).toBe(true);

      vi.advanceTimersByTime(LIVENESS_WINDOW_MS + 1);

      const wsB = makeFakeWs();
      await handlers.message(
        wsB as unknown as Parameters<typeof handlers.message>[0],
        hello('sess-b', KEY_B),
      );
      // sess-a was the LRU victim.
      expect(sessionEngines.has('sess-a')).toBe(false);

      vi.advanceTimersByTime(LIVENESS_WINDOW_MS + 1);

      // sess-a's socket is still open and dispatches its next frame. Before
      // this fix, ws-server hard-closed it here with code 1008 (a code the
      // client treats as non-retryable) and the copy never even reached the
      // demo UI. The fix re-derives the engine fresh via getOrCreate, which
      // rebuilds a working engine for the evicted session instead.
      await handlers.message(
        wsA as unknown as Parameters<typeof handlers.message>[0],
        encodeEnvelope(HistoryGetMessage({ sessionId: SessionId('sess-a') })),
      );

      expect(wsA.closedWith).toBeNull();
      expect(wsA.sent).toHaveLength(1);
      const decoded = decodeServerEnvelope(wsA.sent[0]);
      expect(isOk(decoded)).toBe(true);
      if (!isOk(decoded)) throw new Error('expected a decodable reply');
      expect(decoded.value.type).toBe('engine.history.response');

      sessionEngines.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second connection offering a different apiKey for the same sessionId never leaves the first socket dispatching against the orphaned engine', async () => {
    const sessionEngines = makeSessionEngines();
    const handlers = createWebSocketHandlers({
      hosted: true,
      sessionEngines,
      sharedEngine: null,
      sharedEngineInitError: null,
    });

    const wsA = makeFakeWs();
    await handlers.message(
      wsA as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-shared', KEY_A),
    );

    // A different apiKey for the SAME sessionId: SessionEngineManager evicts
    // and rebuilds scoped to KEY_B, orphaning the engine wsA's hello built.
    // A cached ws.data.engine on wsA would now be a stale reference to an
    // engine the registry no longer tracks.
    const wsB = makeFakeWs();
    await handlers.message(
      wsB as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-shared', KEY_B),
    );
    await handlers.message(
      wsB as unknown as Parameters<typeof handlers.message>[0],
      encodeEnvelope(
        AssistantInjectionMessage({
          sessionId: SessionId('sess-shared'),
          content: 'seeded by wsB',
        }),
      ),
    );

    // wsA (still holding its own apiKey, KEY_A) dispatches next. If ws-server
    // served a cached engine reference instead of re-deriving it, this could
    // either throw against a torn-down engine or — worse — silently read
    // wsB's conversation. Re-deriving via getOrCreate(sessionId, KEY_A) sees
    // the stored entry is now scoped to KEY_B, so it evicts and rebuilds
    // again — a brand-new, empty-history engine, never wsB's.
    await handlers.message(
      wsA as unknown as Parameters<typeof handlers.message>[0],
      encodeEnvelope(
        HistoryGetMessage({ sessionId: SessionId('sess-shared') }),
      ),
    );

    expect(wsA.closedWith).toBeNull();
    const decoded = decodeServerEnvelope(wsA.sent[wsA.sent.length - 1]);
    expect(isOk(decoded)).toBe(true);
    if (!isOk(decoded)) throw new Error('expected a decodable reply');
    expect(decoded.value.type).toBe('engine.history.response');
    if (decoded.value.type !== 'engine.history.response')
      throw new Error('unreachable');
    // Empty, not just "missing wsB's entry": a fresh engine rebuilt for
    // KEY_A has no history at all, which is the actual proof wsA never
    // touched wsB's engine — a partial-match assertion could pass even if
    // some other stale state leaked through.
    expect(decoded.value.entries).toHaveLength(0);
    expect(decoded.value.entries).not.toContainEqual(
      expect.objectContaining({ kind: 'injection', content: 'seeded by wsB' }),
    );

    sessionEngines.dispose();
  });
});

describe('createWebSocketHandlers heartbeat refreshes the idle TTL (Fix 2)', () => {
  it('a heartbeat.ping keeps an otherwise-idle session alive past the TTL that would have evicted it', async () => {
    vi.useFakeTimers();
    try {
      const sessionEngines = makeSessionEngines({ idleTtlMs: 20 });
      const handlers = createWebSocketHandlers({
        hosted: true,
        sessionEngines,
        sharedEngine: null,
        sharedEngineInitError: null,
      });

      const ws = makeFakeWs();
      await handlers.message(
        ws as unknown as Parameters<typeof handlers.message>[0],
        hello('sess-hb', KEY_A),
      );
      expect(sessionEngines.has('sess-hb')).toBe(true);

      vi.advanceTimersByTime(12);
      // A heartbeat 12ms in — before the fix, the heartbeat branch returned
      // before touching the manager at all, so this had no effect on the
      // TTL clock.
      await handlers.message(
        ws as unknown as Parameters<typeof handlers.message>[0],
        JSON.stringify({ type: 'heartbeat.ping' }),
      );

      vi.advanceTimersByTime(12);
      // 24ms have elapsed since hello (> the original 20ms TTL), but the
      // heartbeat at 12ms must have reset the deadline to 32ms.
      expect(sessionEngines.has('sess-hb')).toBe(true);

      vi.advanceTimersByTime(30);
      // No further heartbeat arrives — the session must eventually expire.
      expect(sessionEngines.has('sess-hb')).toBe(false);

      sessionEngines.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not resurrect an evicted session — a heartbeat for a session that is already gone stays gone', async () => {
    // touch() (which the heartbeat branch must use, not getOrCreate()) is
    // documented as a no-op once the session is gone. A heartbeat must not
    // rebuild an engine for an abandoned session; only real dispatch should.
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
      hello('sess-gone', KEY_A),
    );
    sessionEngines.evict('sess-gone');
    expect(sessionEngines.has('sess-gone')).toBe(false);

    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      JSON.stringify({ type: 'heartbeat.ping' }),
    );

    expect(sessionEngines.has('sess-gone')).toBe(false);
    sessionEngines.dispose();
  });
});

describe('createWebSocketHandlers pre-hello frame handling', () => {
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

describe('createWebSocketHandlers capacity handling', () => {
  it('closes the hello handshake with 1008 when the container is full of live sessions', async () => {
    // maxSessions: 1 plus a still-live sess-a means the visitor sending
    // sess-b's hello is the one who arrived once the container was already
    // full -- exactly the case the client's 1008/non-retryable handling
    // exists for: reconnecting here cannot succeed, so the client must not
    // retry.
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
      hello('sess-a', KEY_A),
    );
    expect(sessionEngines.has('sess-a')).toBe(true);

    const wsB = makeFakeWs();
    await handlers.message(
      wsB as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-b', KEY_B),
    );

    expect(wsB.closedWith?.code).toBe(1008);
    expect(wsB.closedWith?.reason).toContain('capacity');
    // The live session must be untouched -- refusing sess-b must not have
    // silently evicted it anyway.
    expect(sessionEngines.has('sess-a')).toBe(true);

    sessionEngines.dispose();
  });

  it('closes an in-flight dispatch with 1008 when rebuilding its session would require evicting a live neighbor', async () => {
    // Models a socket whose session was already reclaimed (e.g. by the idle
    // TTL) while the tab stayed open, arriving to find the one capacity slot
    // now held by someone else's still-live session.
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
      hello('sess-a', KEY_A),
    );
    sessionEngines.evict('sess-a');

    const wsB = makeFakeWs();
    await handlers.message(
      wsB as unknown as Parameters<typeof handlers.message>[0],
      hello('sess-b', KEY_B),
    );
    expect(sessionEngines.has('sess-b')).toBe(true);

    // wsA dispatches next: its session is gone, so re-deriving the engine
    // tries to rebuild it -- which would require evicting sess-b, still
    // live. The dispatch path must translate that refusal into the same
    // terminal 1008 the hello path uses, not silently drop the frame.
    await handlers.message(
      wsA as unknown as Parameters<typeof handlers.message>[0],
      encodeEnvelope(HistoryGetMessage({ sessionId: SessionId('sess-a') })),
    );

    expect(wsA.closedWith?.code).toBe(1008);
    expect(wsA.closedWith?.reason).toContain('capacity');
    expect(sessionEngines.has('sess-b')).toBe(true);

    sessionEngines.dispose();
  });

  it('does not close the socket on a dispatch-time engine-construction failure -- replies with a correlated engine.error instead', async () => {
    // Distinct from the capacity case above: any OTHER getOrCreate failure
    // (a construction error, a bad key) must keep falling through to the
    // engine-null branch. Closing the socket for a transient construction
    // failure would strand a visitor whose next frame might well succeed.
    let calls = 0;
    const sessionEngines = new SessionEngineManager({
      maxSessions: 50,
      idleTtlMs: 30 * 60 * 1000,
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
      systemRules: 'test rules',
      createAdapter: () => {
        calls += 1;
        if (calls === 1) return fakeAdapter;
        throw new Error('adapter temporarily unavailable');
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
      hello('sess-c', KEY_A),
    );
    expect(sessionEngines.has('sess-c')).toBe(true);

    // Force the next getOrCreate to miss and rebuild, hitting the adapter's
    // second (throwing) call.
    sessionEngines.evict('sess-c');

    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      encodeEnvelope(HistoryGetMessage({ sessionId: SessionId('sess-c') })),
    );

    expect(ws.closedWith).toBeNull();
    expect(ws.sent).toHaveLength(1);
    const decoded = decodeServerEnvelope(ws.sent[0]);
    expect(isOk(decoded)).toBe(true);
    if (!isOk(decoded)) throw new Error('expected a decodable reply');
    expect(decoded.value.type).toBe('engine.error');

    sessionEngines.dispose();
  });
});
