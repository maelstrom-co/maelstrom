import {
  ChartRequestMessage,
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

// createEngineMock must be created via vi.hoisted: vitest hoists vi.mock
// factories above the rest of the module, so a plain outer `const`
// referenced from inside the factory would be read before its own
// initializer runs.
const createEngineMock = vi.hoisted(() => vi.fn());
vi.mock('@maelstrom-co/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/engine')>()),
  createEngine: createEngineMock,
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
  attachment: unknown = null;
  send(data: string) {
    this.sent.push(data);
  }
  serializeAttachment(v: unknown) {
    this.attachment = v;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  close() {}
}

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

  it('requests a rehello after a wake, and replays the buffered frame', async () => {
    createEngineMock.mockReturnValue({
      handle: vi.fn().mockResolvedValue({ ok: true, value: null }),
    });
    const ws = new FakeWs();
    // Simulate a wake: attachment survived, in-memory key did not, so this
    // is a brand-new instance that has never seen the key.
    ws.attachment = { helloed: true, sessionId: 's-1' };
    const woken = new SessionDO(makeCtx([ws]) as never, {} as never);

    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    expect(ws.sent.at(-1)).toContain('playground.rehello');

    await woken.webSocketMessage(ws as never, HELLO);
    // The frame that triggered the rehello must be answered, not dropped —
    // otherwise the visitor's request silently vanishes and the UI waits
    // for the correlator timeout.
    expect(ws.sent.length).toBeGreaterThan(1);
  });

  it('buffers exactly one frame while awaiting the rehello, independently per connection', async () => {
    createEngineMock.mockReturnValue({
      handle: vi.fn().mockResolvedValue({ ok: true, value: null }),
    });
    const ws = new FakeWs();
    ws.attachment = { helloed: true, sessionId: 's-1' };
    const woken = new SessionDO(makeCtx([ws]) as never, {} as never);

    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    await woken.webSocketMessage(ws as never, CHART_REQUEST);
    expect(
      ws.sent.filter((f) => f.includes('playground.rehello')),
    ).toHaveLength(3);

    ws.sent.length = 0;
    await woken.webSocketMessage(ws as never, HELLO);

    // Exactly one replay. An unbounded buffer would replay every frame that
    // arrived during the gap, multiplying one visitor action into N engine
    // calls billed against their key.
    expect(ws.sent).toHaveLength(1);

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
  });

  it("does not let a second connection spend the first connection's key", async () => {
    createEngineMock.mockReturnValue({
      handle: vi.fn().mockResolvedValue({ ok: true, value: null }),
    });
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
        (c[0] as { adapter: { __testApiKey: string } }).adapter.__testApiKey,
    );
    expect(adapterKeys.every((k) => k === B_KEY)).toBe(true);
  });

  it('does not let an engine construction failure surface the key it was built from', async () => {
    const secret = A_KEY;
    createEngineMock.mockImplementation(() => {
      throw new Error(`upstream rejected key ${secret}`);
    });
    const ws = new FakeWs();
    const does = new SessionDO(makeCtx([ws]) as never, {} as never);
    await does.webSocketMessage(ws as never, HELLO);

    let thrown: unknown;
    try {
      await does.webSocketMessage(ws as never, CHART_REQUEST);
    } catch (err) {
      thrown = err;
    }

    // createEngine's own construction failure (bad key, adapter error) must
    // never let the key it was building from reach whatever catches this —
    // an uncaught throw here is logged by the Workers runtime, and
    // observability.logs.persist retains it.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(secret);
  });

  it('tears down the shared engine only once the last socket on the object has closed, not on every close', async () => {
    createEngineMock.mockReturnValue({
      handle: vi.fn().mockResolvedValue({ ok: true, value: null }),
    });
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
