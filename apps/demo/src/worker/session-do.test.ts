import {
  WorkspaceResultSchema,
  workspaceRun,
} from '@maelstrom-co/agui/contract';
import {
  HEARTBEAT_PING_FRAME,
  HEARTBEAT_PONG_FRAME,
} from '@maelstrom-co/connectors';
import {
  ChartRequestMessage,
  ChartRequestMessageSchema,
  encodeEnvelope,
  SessionId,
} from '@maelstrom-co/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// DurableObject only exists as a virtual module inside a real Workers
// runtime, not under plain vitest — mirrors worker/index.test.ts's mock of
// 'cloudflare:workers' for the same reason. A minimal base class (ctx,
// env assigned, nothing else) is all SessionDO's `super(ctx, env)` needs.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

// WebSocketRequestResponsePair is a Workers-runtime *global*, not a module
// import, so vi.mock can't intercept it the way it does 'cloudflare:workers'
// above. The fake ctx already no-ops setWebSocketAutoResponse, but the
// constructor still evaluates `new WebSocketRequestResponsePair(...)` before
// handing it there, so the global itself must exist under plain vitest.
(
  globalThis as { WebSocketRequestResponsePair?: unknown }
).WebSocketRequestResponsePair ??= class {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
};

// createEngineMock and llmPlannerMock must be created via vi.hoisted: vitest
// hoists vi.mock factories above the rest of the module, so a plain outer
// `const` referenced from inside the factory would be read before its own
// initializer runs.
const createEngineMock = vi.hoisted(() => vi.fn());
// The real llmPlanner returns an opaque Stage function, so a config's
// `planner` field can no longer be inspected for the adapter it was built
// from. Returning the options verbatim instead keeps `planner` a stand-in
// for "what llmPlanner was called with", which is what the API key tests
// below need to reach into.
const llmPlannerMock = vi.hoisted(() => vi.fn((options: unknown) => options));
vi.mock('@maelstrom-co/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/engine')>()),
  createEngine: createEngineMock,
}));
vi.mock('@maelstrom-co/planner-llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/planner-llm')>()),
  llmPlanner: llmPlannerMock,
}));
vi.mock('@tanstack/ai-openai', () => ({
  // Surfaces the key the adapter was built with, which is the thing under
  // test — the real adapter keeps it private.
  createOpenaiChat: (model: string, apiKey: string) => ({
    kind: 'text',
    name: 'fake',
    model,
    __testApiKey: apiKey,
  }),
}));

const { SessionDO } = await import('./session-do');

class FakeWs {
  readonly sent: string[] = [];
  // Recorded, not ignored: close CODES are load-bearing on this transport --
  // WebSocketConnector branches its reconnect behavior on them (1008 is
  // flagged non-retryable), so a handler that closed with the wrong code
  // would silently change client reconnect behavior while a `close() {}`
  // no-op kept every assertion green.
  readonly closes: { code?: number; reason?: string }[] = [];
  attachment: unknown = null;
  send(data: string) {
    this.sent.push(data);
  }
  serializeAttachment(v: unknown) {
    // Mirrors the platform's own 16,384-byte cap, which THROWS rather than
    // truncating. Without this the fake accepts payloads the real runtime
    // would reject, and the guard against an oversized sessionId could
    // regress with the suite still passing.
    if (JSON.stringify(v).length > 16_384) {
      throw new RangeError('Attachment too large');
    }
    this.attachment = v;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  close(code?: number, reason?: string) {
    this.closes.push({ code, reason });
  }
}

/**
 * An engine whose dispatch actually succeeds. The shape matters: a `handle`
 * returning `{ ok: true, value: null }` makes handleEnvelope throw on
 * `result.value.type`, which it catches and maps to `engine.error` -- so
 * every "the frame was replayed" assertion would pass on a FAILED replay.
 * Assertions below check for `engine.maelstrom.response` specifically, which
 * only this shape can produce.
 */
function fakeEngine() {
  return {
    handle: vi.fn(async (envelope: { id: string; sessionId: string }) => ({
      ok: true as const,
      value: {
        type: 'chart_response' as const,
        id: envelope.id,
        sessionId: envelope.sessionId,
        response: {
          type: 'maelstrom_response' as const,
          requestId: envelope.id,
          userMessage: 'done',
          rationale: 'because',
          executionPlan: [],
          layout: { type: 'grid' as const, positions: [] },
        },
      },
    })),
    getHistory: vi.fn(),
  };
}

const NOKEY = JSON.stringify({ type: 'playground.nokey' });

function makeCtx(sockets: FakeWs[] = []) {
  return {
    acceptWebSocket: vi.fn(),
    setWebSocketAutoResponse: vi.fn(),
    getWebSockets: () => sockets,
  };
}

const A_KEY = 'sk-0123456789012345678901234567890123456789';
const B_KEY = 'sk-9999999999999999999999999999999999999999';

const HELLO = JSON.stringify({
  type: 'playground.hello',
  sessionId: 's-1',
  apiKey: A_KEY,
});

const OTHER_HELLO = JSON.stringify({
  type: 'playground.hello',
  sessionId: 's-1',
  apiKey: B_KEY,
});

const CHART_REQUEST = encodeEnvelope(
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

describe('SessionDO', () => {
  // createEngineMock is module-scoped (vi.hoisted, above), so its call count
  // otherwise carries across tests. This does not replace the explicit
  // mockClear() calls inside individual tests below -- several of those are
  // mid-test resets (e.g. isolating one connection's dispatch from another
  // connection's setup earlier in the SAME test) that this beforeEach cannot
  // reach; it only guarantees every test starts from zero.
  beforeEach(() => {
    createEngineMock.mockClear();
  });

  it('marks the connection helloed in the attachment without storing the key', async () => {
    const ws = new FakeWs();
    const does = new SessionDO(makeCtx() as never, {} as never);
    await does.webSocketMessage(ws as never, HELLO);

    const serialized = JSON.stringify(ws.attachment);
    // The marker must survive hibernation; the key must never be written
    // anywhere the platform retains. This assertion is the custody invariant.
    expect(serialized).toContain('helloed');
    expect(serialized).not.toContain('sk-');
  });

  it('restores an AG-UI pending acknowledgment across rehello without repeating planning or retaining content', async () => {
    const engine = fakeEngine();
    createEngineMock.mockReturnValue(engine);
    const ws = new FakeWs();
    const first = new SessionDO(makeCtx([ws]) as never, {} as never);
    await first.webSocketMessage(ws as never, HELLO);
    const run = workspaceRun('s-1', {
      kind: 'plan',
      sequence: 1,
      revision: 0,
      message: ChartRequestMessageSchema.parse(JSON.parse(CHART_REQUEST)),
    });
    await first.webSocketMessage(
      ws as never,
      JSON.stringify({ type: 'demo.agui.run', input: run }),
    );
    const result = WorkspaceResultSchema.parse(JSON.parse(ws.sent[1]).value);
    expect(engine.handle).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(ws.attachment)).not.toContain(A_KEY);
    expect(JSON.stringify(ws.attachment)).not.toContain('because');
    const ack = workspaceRun('s-1', {
      kind: 'applied',
      sequence: 2,
      application: {
        correlation: result.correlation,
        status: 'applied',
        actions: [],
        chart: {
          instances: [],
          layout: null,
          layoutMode: 'grid',
          chartDimensions: { rows: 8, columns: 12 },
        },
      },
    });
    const second = new SessionDO(makeCtx([ws]) as never, {} as never);
    ws.sent.length = 0;
    await second.webSocketMessage(
      ws as never,
      JSON.stringify({ type: 'demo.agui.run', input: ack }),
    );
    expect(ws.sent).toEqual([JSON.stringify({ type: 'playground.rehello' })]);
    ws.sent.length = 0;
    await second.webSocketMessage(ws as never, HELLO);
    expect(ws.sent.map((wire) => JSON.parse(wire).type)).toEqual([
      'RUN_STARTED',
      'CUSTOM',
      'RUN_FINISHED',
    ]);
    expect(JSON.parse(ws.sent[1]).value).toMatchObject({
      revision: 1,
      status: 'applied',
    });
    expect(engine.handle).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(ws.attachment)).not.toContain(A_KEY);
    const third = new SessionDO(makeCtx([ws]) as never, {} as never);
    await third.webSocketMessage(ws as never, HELLO);
    ws.sent.length = 0;
    await third.webSocketMessage(
      ws as never,
      JSON.stringify({ type: 'demo.agui.run', input: ack }),
    );
    expect(JSON.parse(ws.sent.at(-1) ?? '{}').type).toBe('RUN_ERROR');
    expect(engine.handle).toHaveBeenCalledTimes(1);
  });

  it('requests a rehello after a wake, and replays the buffered frame', async () => {
    createEngineMock.mockReturnValue(fakeEngine());
    const ws = new FakeWs();
    // Simulate a wake: attachment survived, in-memory key did not, so this
    // is a brand-new instance that has never seen the key.
    ws.attachment = { helloed: true, sessionId: 's-1' };
    const woken = new SessionDO(makeCtx([ws]) as never, {} as never);

    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    expect(ws.sent.at(-1)).toContain('playground.rehello');

    ws.sent.length = 0;
    await woken.webSocketMessage(ws as never, HELLO);
    // The frame that triggered the rehello must be answered THROUGH THE
    // ENGINE, not merely answered: asserting only that some frame came back
    // passes just as happily on the engine.error a failed replay produces,
    // which is the exact failure this test exists to catch.
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toContain('"type":"engine.maelstrom.response"');
  });

  it('buffers exactly one frame while awaiting the rehello, independently per connection', async () => {
    createEngineMock.mockReturnValue(fakeEngine());
    const ws = new FakeWs();
    ws.attachment = { helloed: true, sessionId: 's-1' };
    const woken = new SessionDO(makeCtx([ws]) as never, {} as never);

    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    // The first call buffers the frame and requests a rehello. Further
    // calls while that rehello is still unanswered do NOT grow the buffer
    // or repeat the bare rehello -- a second bare rehello would loop
    // forever with no diagnostic. They get an immediate error instead.
    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    expect(
      ws.sent.filter((f) => f.includes('playground.rehello')),
    ).toHaveLength(1);
    // "re-authenticating", NOT "No API key set". These frames raced the
    // client's answer to the rehello, and the client has not said it lacks
    // a key -- it has not answered at all yet. Telling this visitor to open
    // the key drawer would send them to fix something that isn't broken;
    // the key-drawer copy is reserved for a client that explicitly declined
    // (see the playground.nokey test below).
    expect(ws.sent.filter((f) => f.includes('re-authenticating'))).toHaveLength(
      2,
    );
    expect(ws.sent.filter((f) => f.includes('No API key set'))).toHaveLength(0);

    ws.sent.length = 0;
    await woken.webSocketMessage(ws as never, HELLO);

    // Exactly one replay -- of the FIRST call's frame, the only one ever
    // buffered. An unbounded buffer would replay every frame that arrived
    // during the gap, multiplying one visitor action into N engine calls
    // billed against their key.
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toContain('"type":"engine.maelstrom.response"');

    // Two sockets on the SAME object can each wake from hibernation
    // independently (two tabs on one session). #pending is keyed per
    // connection, not a single object-scoped slot — a shared slot would let
    // the second socket's rehello silently overwrite (or be blocked by) the
    // first's, dropping whichever triggering frame lost the race.
    const a = new FakeWs();
    const b = new FakeWs();
    a.attachment = { helloed: true, sessionId: 's-1' };
    b.attachment = { helloed: true, sessionId: 's-1' };
    const bothWoken = new SessionDO(makeCtx([a, b]) as never, {} as never);

    await bothWoken.webSocketMessage(a as never, CHART_REQUEST);
    await bothWoken.webSocketMessage(b as never, CHART_REQUEST);
    expect(a.sent.at(-1)).toContain('playground.rehello');
    expect(b.sent.at(-1)).toContain('playground.rehello');

    a.sent.length = 0;
    b.sent.length = 0;
    await bothWoken.webSocketMessage(a as never, HELLO);
    await bothWoken.webSocketMessage(b as never, OTHER_HELLO);

    // Both triggering frames replayed after their own connection's hello —
    // neither was dropped by the other's.
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(a.sent[0]).toContain('"type":"engine.maelstrom.response"');
    expect(b.sent[0]).toContain('"type":"engine.maelstrom.response"');
  });

  it('answers a heartbeat that reaches webSocketMessage directly', async () => {
    // setWebSocketAutoResponse answers a real ping without ever reaching
    // webSocketMessage — this covers the defense-in-depth path for if that
    // ever misses, which previously fell into `default: return` and left
    // the ping silently unanswered (a reconnect loop with no diagnostic).
    const ws = new FakeWs();
    const does = new SessionDO(makeCtx([ws]) as never, {} as never);
    await does.webSocketMessage(ws as never, HEARTBEAT_PING_FRAME);
    expect(ws.sent).toEqual([HEARTBEAT_PONG_FRAME]);
  });

  it('answers the buffered frame immediately when the client declines the rehello', async () => {
    const ws = new FakeWs();
    // Simulate a wake with a visitor who cleared their key: attachment
    // survived, key never comes back over the wire.
    ws.attachment = { helloed: true, sessionId: 's-1' };
    const woken = new SessionDO(makeCtx([ws]) as never, {} as never);

    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    expect(ws.sent.at(-1)).toContain('playground.rehello');

    ws.sent.length = 0;
    await woken.webSocketMessage(ws as never, NOKEY);

    // The decline is definitive, so the buffered frame can never be
    // replayed -- it must be answered NOW. Holding it until the socket
    // closes would leave the visitor's request to die on the client's 30s
    // correlator timeout with no diagnostic at all.
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toContain('No API key set');
  });

  it('stops re-arming the rehello once the client has declined it', async () => {
    const ws = new FakeWs();
    ws.attachment = { helloed: true, sessionId: 's-1' };
    const woken = new SessionDO(makeCtx([ws]) as never, {} as never);

    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    await woken.webSocketMessage(ws as never, NOKEY);

    ws.sent.length = 0;
    await woken.webSocketMessage(ws as never, CHART_REQUEST);

    // This connection has said it has no key. Asking again would be a
    // handshake loop with no diagnostic; it gets the actionable error
    // directly, exactly like a visitor who never helloed at all.
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).not.toContain('playground.rehello');
    expect(ws.sent[0]).toContain('No API key set');
  });

  it('recovers a declined connection once a real hello arrives', async () => {
    createEngineMock.mockReturnValue(fakeEngine());
    const ws = new FakeWs();
    ws.attachment = { helloed: true, sessionId: 's-1' };
    const woken = new SessionDO(makeCtx([ws]) as never, {} as never);

    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    await woken.webSocketMessage(ws as never, NOKEY);

    // The visitor pastes a key. A decline must not be a permanent verdict on
    // the connection -- if it were, they would stay locked out of their own
    // session until they reloaded the page.
    await woken.webSocketMessage(ws as never, HELLO);
    ws.sent.length = 0;
    await woken.webSocketMessage(ws as never, CHART_REQUEST);

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toContain('"type":"engine.maelstrom.response"');
  });

  it('builds every engine with a redacting logger', async () => {
    createEngineMock.mockReturnValue(fakeEngine());
    const ws = new FakeWs();
    const does = new SessionDO(makeCtx([ws]) as never, {} as never);
    await does.webSocketMessage(ws as never, HELLO);
    await does.webSocketMessage(ws as never, CHART_REQUEST);

    // The single mechanism standing between a provider's error and a
    // permanently retained log line: the Alchemy Worker declaration persists
    // logs, and createEngine's DEFAULT logger is
    // consoleLogger, which writes OpenAI's 401 echo of the rejected key
    // straight to stdout. Nothing else in this suite fails if the `logger`
    // option is dropped from #engineFor, so without this test the custody
    // invariant could regress silently.
    expect(createEngineMock).toHaveBeenCalledTimes(1);
    const config = createEngineMock.mock.calls[0]?.[0] as {
      logger?: { error: (m: string, e?: unknown) => void };
    };
    expect(config.logger).toBeDefined();

    // Behavioral, not just presence: assert the logger actually scrubs. A
    // logger that was wired up but passed the key through would satisfy a
    // toBeDefined() check while leaking exactly what it exists to prevent.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      config.logger?.error(`upstream rejected ${A_KEY}`);
      const logged = spy.mock.calls.flat().join(' ');
      expect(logged).not.toContain(A_KEY);
      expect(logged).toContain('[redacted]');
    } finally {
      spy.mockRestore();
    }
  });

  it('closes with 1002 on pre-hello traffic that is not even a protocol envelope', async () => {
    const ws = new FakeWs();
    const does = new SessionDO(makeCtx([ws]) as never, {} as never);

    // Never helloed, and not decodable as a client envelope -- the one case
    // that earns a close rather than a correlated error reply.
    await does.webSocketMessage(ws as never, JSON.stringify({ type: 'junk' }));

    // The CODE is the assertion, not merely that a close happened:
    // WebSocketConnector branches reconnect behavior on close codes, so
    // closing with the wrong one silently changes client behavior.
    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]?.code).toBe(1002);
    expect(ws.sent).toHaveLength(0);
  });

  it('rejects a hello whose sessionId would overflow the attachment cap', async () => {
    const ws = new FakeWs();
    const does = new SessionDO(makeCtx([ws]) as never, {} as never);

    // serializeAttachment throws past 16,384 bytes, and the hello handler
    // sits OUTSIDE webSocketMessage's dispatch try/catch -- so an unbounded
    // sessionId from a crafted frame would escape as an unhandled exception
    // that observability.logs.persist then retains. It must be rejected at
    // the guard instead, and treated as ordinary pre-hello traffic.
    await expect(
      does.webSocketMessage(
        ws as never,
        JSON.stringify({
          type: 'playground.hello',
          sessionId: 'x'.repeat(20_000),
          apiKey: A_KEY,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(ws.attachment).toBeNull();
  });

  it("does not let a second connection spend the first connection's key", async () => {
    createEngineMock.mockReturnValue(fakeEngine());
    const a = new FakeWs();
    const b = new FakeWs();
    const does = new SessionDO(makeCtx([a, b]) as never, {} as never);

    await does.webSocketMessage(a as never, HELLO);
    // A must actually dispatch through the engine so #engine/#engineKey are
    // genuinely populated with A's key. Without this, #engineFor's guard
    // (`this.#engine && this.#engineKey === apiKey`) short-circuits on
    // `this.#engine` being null and the `#engineKey === apiKey` half of the
    // guard — the thing this test exists to cover — is never evaluated.
    await does.webSocketMessage(a as never, CHART_REQUEST);

    await does.webSocketMessage(b as never, OTHER_HELLO);
    createEngineMock.mockClear();
    await does.webSocketMessage(b as never, CHART_REQUEST);

    // A sessionId is correlation data, not a secret, so anyone who obtains
    // one can open a second socket. Dispatching B's traffic through the
    // engine A's key built would spend A's key on B's behalf. Assert
    // positively that the engine built for B's dispatch was built from
    // B_KEY — asserting only "not A_KEY" would also pass for an engine
    // built from an empty string, undefined, or a stale third key.
    expect(createEngineMock).toHaveBeenCalledTimes(1);
    const adapterKeys = createEngineMock.mock.calls.map(
      (c) =>
        (c[0] as { planner: { adapter: { __testApiKey: string } } }).planner
          .adapter.__testApiKey,
    );
    expect(adapterKeys.every((k) => k === B_KEY)).toBe(true);
  });

  it('does not let an engine construction failure surface the key it was built from, or escape webSocketMessage as an unhandled exception', async () => {
    const secret = A_KEY;
    createEngineMock.mockImplementation(() => {
      throw new Error(`upstream rejected key ${secret}`);
    });
    const ws = new FakeWs();
    const does = new SessionDO(makeCtx([ws]) as never, {} as never);
    await does.webSocketMessage(ws as never, HELLO);

    // Lazy engine construction is deferred to first dispatch, so a
    // construction failure surfaces here, not from the hello handler. It
    // must not reject/throw: an uncaught exception out of webSocketMessage
    // is logged by the Workers runtime, and observability.logs.persist
    // retains it -- an opaque failure for the visitor and noise in
    // persisted logs, on top of the key-leak risk.
    await expect(
      does.webSocketMessage(ws as never, CHART_REQUEST),
    ).resolves.toBeUndefined();

    // A correlated engine.error reply instead, carrying the factory's
    // redacted message VERBATIM. Asserting the exact sentence, not just any
    // error frame: whatever rejects getEngine's promise is rendered into
    // this reply verbatim (the pinned Effect rc.111 rejects with the typed
    // error itself), so this pins both that the typed error reached the
    // handler and that its text is the scrubbed one — a wrapper or
    // diagnostic substitution would fail here.
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).not.toContain(secret);
    expect(ws.sent[0]).toContain('upstream rejected key [redacted]');
    expect(ws.sent[0]).toContain('engine.error');
  });

  it('tears down the shared engine only once the last socket on the object has closed, not on every close', async () => {
    createEngineMock.mockReturnValue(fakeEngine());
    // The previous test leaves createEngineMock mid-throw with its own call
    // count -- clear both so the counts asserted below start from this
    // test's own dispatches, not whatever the suite ran before it.
    createEngineMock.mockClear();
    const a = new FakeWs();
    const b = new FakeWs();
    // A real array reference, not a fresh copy per call: mutating it between
    // the two closes below is how this fake simulates getWebSockets()
    // reporting a shrinking connection count across the object's lifetime,
    // same as workerd does.
    const sockets = [a, b];
    const does = new SessionDO(makeCtx(sockets) as never, {} as never);

    await does.webSocketMessage(a as never, HELLO);
    await does.webSocketMessage(a as never, CHART_REQUEST); // builds the engine
    await does.webSocketMessage(b as never, HELLO);
    await does.webSocketMessage(b as never, CHART_REQUEST); // same key -- reuses it
    expect(createEngineMock).toHaveBeenCalledTimes(1);

    // A closes while B is still live. getWebSockets() still reports BOTH
    // sockets while this handler runs (verified empirically against workerd
    // -- see webSocketClose's own comment), so length is 2 here, not 1.
    await does.webSocketClose(a as never);

    createEngineMock.mockClear();
    await does.webSocketMessage(b as never, CHART_REQUEST);
    // If A's close had torn the engine down, B's next dispatch would rebuild
    // it from scratch -- createEngine would be called again. It must not be:
    // the engine (and B's conversation history in it) survives a close as
    // long as another socket on the object is still being served.
    expect(createEngineMock).not.toHaveBeenCalled();

    // B is now the only socket left. Mirror A having actually finished
    // closing by removing it from the fake runtime's list, then close B too
    // -- the object's LAST socket closing, where getWebSockets() reports 1
    // (itself, mid-close), not 0.
    sockets.splice(sockets.indexOf(a), 1);
    await does.webSocketClose(b as never);

    await does.webSocketMessage(b as never, HELLO);
    createEngineMock.mockClear();
    await does.webSocketMessage(b as never, CHART_REQUEST);
    // The object has no live socket left after B's close, so the engine (and
    // the key it was built from) must be gone -- this dispatch has to
    // rebuild it. This is the case that actually distinguishes `<= 1` from
    // the `=== 0` a careful reader would naturally reach for: workerd never
    // reports 0 from inside webSocketClose (the closing socket itself is
    // still counted), so `=== 0` would never fire and the engine -- and the
    // plaintext apiKey it holds in #engineKey -- would leak past every
    // session's last disconnect.
    expect(createEngineMock).toHaveBeenCalledTimes(1);
  });
});
