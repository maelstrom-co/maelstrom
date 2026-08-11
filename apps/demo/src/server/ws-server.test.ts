import {
  HEARTBEAT_PING_FRAME,
  HEARTBEAT_PONG_FRAME,
} from '@maelstrom-co/client';
import type { Engine } from '@maelstrom-co/engine';
import {
  AssistantInjectionMessage,
  ChartRequestMessage,
  decodeServerEnvelope,
  encodeEnvelope,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock factories are hoisted, so their shared state must be initialized first.
const createEngineMock = vi.hoisted(() => vi.fn());
vi.mock('@maelstrom-co/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/engine')>()),
  createEngine: createEngineMock,
}));

import {
  buildSharedEngine,
  createWebSocketHandlers,
  type SocketData,
  truncateCloseReason,
} from './ws-server';

/**
 * Minimal stand-in for Bun.ServerWebSocket<SocketData> — only what the
 * handlers touch. `helloReceived` defaults to `true`: that is the only
 * state `Bun.serve`'s upgrade handler ever actually produces (it hardcodes
 * `data: { helloReceived: true }`), so a test exercising real local-mode
 * traffic must start from it rather than from a state the handler can
 * never observe in production.
 */
function makeFakeWs(helloReceived = true) {
  const sent: string[] = [];
  let closedWith: { code: number; reason: string } | null = null;
  return {
    data: {
      helloReceived,
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

const chartRequest = encodeEnvelope(
  ChartRequestMessage({
    sessionId: SessionId('s-1'),
    request: {
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'hi' }],
        chartDimensions: { rows: 8, columns: 12 },
        layoutMode: 'grid',
      },
      instances: [],
      vessels: [],
      layout: { type: 'grid', positions: [] },
    },
  }),
);

/** A stub Engine whose handled messages always succeed. */
function stubEngine(): Engine {
  return {
    handle: async (message) => {
      switch (message.type) {
        case 'assistant_message':
          return ok({
            type: 'assistant_message_result',
            sessionId: message.sessionId,
            id: message.id,
            outcome: 'inserted',
          });
        case 'chart_request':
          return ok({
            type: 'chart_response',
            sessionId: message.sessionId,
            id: message.id,
            response: {
              type: 'maelstrom_response',
              requestId: message.id,
              userMessage: 'done',
              rationale: 'because',
              executionPlan: [],
              layout: { type: 'grid', positions: [] },
            },
          });
        default: {
          // Keep surprising call sites loud if EngineMessage gains arms.
          const unexpected: never = message;
          throw new Error(
            `stubEngine cannot handle ${(unexpected as { type: string }).type}`,
          );
        }
      }
    },
    getHistory: async () => {
      throw new Error('getHistory not stubbed');
    },
  };
}

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

describe('createWebSocketHandlers pre-hello frame handling', () => {
  // 1008 is the client's "never retry this" signal, so it has to stay
  // reserved for closes a reconnect genuinely cannot fix. A garbled first
  // frame is not one of those: the reconnecting socket sends its handshake
  // again and would succeed. Using 1008 here would strand the visitor on a
  // transient fault with the circuit breaker open.
  it('rejects an undecodable pre-hello frame with a retryable code, not the terminal 1008', async () => {
    const handlers = createWebSocketHandlers({
      sharedEngine: null,
      sharedEngineInitError: null,
    });

    // helloReceived: false is core-level state only — Bun's upgrade handler
    // hardcodes `data: { helloReceived: true }`, so local mode itself can
    // never reach this branch. It stays covered here because dispatchFrame
    // (the shared core) still models it for the DO transport, which does
    // have a real pre-hello window.
    const ws = makeFakeWs(false);
    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      JSON.stringify({ type: 'not-a-protocol-envelope' }),
    );

    expect(ws.closedWith?.code).toBe(1002);
    expect(ws.closedWith?.code).not.toBe(1008);
  });
});

describe('createWebSocketHandlers send paths (local mode)', () => {
  // makeFakeWs() defaults to helloReceived: true — the only state
  // Bun.serve's upgrade path produces — so these exercise the handler the
  // way `bun run dev` actually drives it, not a state it can't reach.
  it('sends a maelstrom_response for a chart_request', async () => {
    const handlers = createWebSocketHandlers({
      sharedEngine: stubEngine(),
      sharedEngineInitError: null,
    });

    const ws = makeFakeWs();
    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      chartRequest,
    );

    // Regression guard: deleting `case 'reply': ws.send(result.wire)` from
    // createWebSocketHandlers would leave this suite green without this
    // assertion, since nothing else in the file drives a real chart_request
    // through to a reply.
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toContain('maelstrom_response');
  });

  it('sends assistant_message.result for an assistant_message', async () => {
    const handlers = createWebSocketHandlers({
      sharedEngine: stubEngine(),
      sharedEngineInitError: null,
    });
    const ws = makeFakeWs();
    const assistantFrame = encodeEnvelope(
      AssistantInjectionMessage({
        sessionId: SessionId('s-1'),
        content: 'seeded note',
        id: MessageId('inj-1'),
      }),
    );

    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      assistantFrame,
    );

    // Regression guard: deleting `case 'reply': ws.send(result.wire)` must
    // fail for assistant acknowledgements as well as chart responses.
    expect(ws.sent).toHaveLength(1);
    const decoded = decodeServerEnvelope(ws.sent[0]);
    expect(decoded.ok).toBe(true);
    if (
      !decoded.ok ||
      decoded.value.type !== 'engine.assistant_message.result'
    ) {
      throw new Error('expected engine.assistant_message.result');
    }
    expect(decoded.value.requestId).toBe(MessageId('inj-1'));
    expect(decoded.value.outcome).toBe('inserted');
  });

  it('answers a heartbeat ping with exactly the pong frame', async () => {
    const handlers = createWebSocketHandlers({
      sharedEngine: null,
      sharedEngineInitError: null,
    });

    const ws = makeFakeWs();
    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      HEARTBEAT_PING_FRAME,
    );

    // Regression guard: deleting `case 'heartbeat': ws.send(HEARTBEAT_PONG_FRAME)`
    // leaves this suite green without this assertion.
    expect(ws.sent).toEqual([HEARTBEAT_PONG_FRAME]);
  });
});

describe('buildSharedEngine redaction', () => {
  // Long enough to exercise generic key-pattern and exact-match redaction.
  const SENTINEL_KEY = 'sk-sentinelKeyThatMustNeverLeak0123456789ABCDEFGH';

  afterEach(() => {
    createEngineMock.mockReset();
  });

  it('redacts the api key out of both the returned init error and the console warning', () => {
    createEngineMock.mockImplementation(() => {
      throw new Error(`upstream rejected key ${SENTINEL_KEY}`);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { engine, initError } = buildSharedEngine(SENTINEL_KEY);

      expect(engine).toBeNull();
      expect(initError).not.toBeNull();
      expect(initError).not.toContain(SENTINEL_KEY);

      const loggedWarning = warnSpy.mock.calls.flat().join(' ');
      expect(loggedWarning).not.toContain(SENTINEL_KEY);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('scrubs the key from the outbound engine.error reply even if sharedEngineInitError were somehow still unredacted', async () => {
    // Exercise the outbound boundary independently of initialization redaction.
    const handlers = createWebSocketHandlers({
      sharedEngine: null,
      sharedEngineInitError: `upstream rejected key ${SENTINEL_KEY}`,
      apiKey: SENTINEL_KEY,
    });

    const ws = makeFakeWs();
    await handlers.message(
      ws as unknown as Parameters<typeof handlers.message>[0],
      chartRequest,
    );

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).not.toContain(SENTINEL_KEY);
    expect(ws.sent[0]).toContain('engine.error');
  });

  it('passes a redacting logger so request-time provider errors cannot leak the key', () => {
    // Provider errors are logged before outbound wire redaction.
    createEngineMock.mockImplementation(() => ({
      handle: async () => {
        throw new Error('unused');
      },
      cancel: () => undefined,
      getHistory: async () => ok([]),
    }));

    const { engine } = buildSharedEngine(SENTINEL_KEY);
    expect(engine).not.toBeNull();

    const config = createEngineMock.mock.calls.at(-1)?.[0] as
      | { logger?: { error: (m: string, e?: unknown, d?: object) => void } }
      | undefined;
    expect(config?.logger).toBeDefined();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      config!.logger!.error(
        'LLM call failed',
        new Error(`Incorrect API key provided: ${SENTINEL_KEY}`),
        { messageId: 'msg-1' },
      );
      const logged = errorSpy.mock.calls
        .flat()
        .map((arg) =>
          arg instanceof Error
            ? `${arg.message}\n${arg.stack ?? ''}`
            : typeof arg === 'string'
              ? arg
              : JSON.stringify(arg),
        )
        .join(' ');
      expect(logged).not.toContain(SENTINEL_KEY);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
