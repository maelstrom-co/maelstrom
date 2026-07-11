import type { ChartRequest } from '@maelstrom-co/protocol';
import { ChartRequestMessage, SessionId } from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionEngineManager } from './session-engine-manager';

// createEngine's config validator (packages/engine/src/lib/validation/engine-config.ts)
// requires kind/name/model plus callable chatStream/structuredOutput on the
// adapter — a bare `{}` fails that zod check before any of the manager's own
// logic runs, so the fixture needs the minimal real shape.
const fakeAdapter = {
  kind: 'text',
  name: 'fake',
  model: 'fake-model',
  chatStream: () => {},
  structuredOutput: () => {},
} as unknown as AnyTextAdapter;

const MINIMAL_CHART_REQUEST: ChartRequest = {
  type: 'chart_request',
  context: {
    updateReasons: [],
    chartDimensions: { rows: 4, columns: 4 },
    layoutMode: 'grid',
  },
  instances: [],
  vessels: [],
  layout: { type: 'grid', positions: [] },
};

function makeManager(overrides: Partial<{ maxSessions: number; idleTtlMs: number }> = {}) {
  return new SessionEngineManager({
    maxSessions: overrides.maxSessions ?? 50,
    idleTtlMs: overrides.idleTtlMs ?? 30 * 60 * 1000,
    systemRules: 'test rules',
    createAdapter: () => fakeAdapter,
  });
}

describe('SessionEngineManager', () => {
  let manager: SessionEngineManager;

  afterEach(() => {
    manager?.dispose();
  });

  it('returns the same engine instance for the same sessionId', () => {
    manager = makeManager();
    const first = manager.getOrCreate('session-a', 'sk-key-a');
    const second = manager.getOrCreate('session-a', 'sk-key-a');
    expect(first).toBe(second);
  });

  it('evicts the least-recently-used session once maxSessions is exceeded', async () => {
    // See the recency test below for why a tick is needed between creates.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

    manager = makeManager({ maxSessions: 2 });
    const first = manager.getOrCreate('session-1', 'sk-1');
    await tick();
    const second = manager.getOrCreate('session-2', 'sk-2');
    expect(manager.size()).toBe(2);
    manager.getOrCreate('session-3', 'sk-3');
    expect(manager.size()).toBe(2);
    // Identity, not just truthiness: getOrCreate returns *an* engine either
    // way, so asserting only toBeTruthy() can't fail if eviction picked the
    // wrong victim (or evicted nothing and just returned the cache hit).
    // Check the survivor first — a cache hit is side-effect-free (no
    // eviction), whereas rebuilding the evicted session-1 below adds a 3rd
    // entry and forces another LRU eviction, which would otherwise disturb
    // this assertion if checked afterward.
    const survivorSession2 = manager.getOrCreate('session-2', 'sk-2');
    expect(survivorSession2).toBe(second);
    const rebuiltSession1 = manager.getOrCreate('session-1', 'sk-1');
    expect(rebuiltSession1).not.toBe(first);
  });

  it('LRU eviction follows recency (touch), not insertion order', async () => {
    // Recency is stamped with Date.now(), which can tie at millisecond
    // resolution for back-to-back synchronous calls — a tie would make the
    // eviction pick ambiguous and defeat the point of this test, so a tiny
    // real delay between each step guarantees strictly increasing
    // timestamps.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

    manager = makeManager({ maxSessions: 2 });
    const first = manager.getOrCreate('session-1', 'sk-1');
    await tick();
    manager.getOrCreate('session-2', 'sk-2');
    await tick();
    // Touching session-1 makes session-2 the least-recently-used one.
    manager.getOrCreate('session-1', 'sk-1');
    await tick();
    manager.getOrCreate('session-3', 'sk-3');

    // Cache-hit check first (side-effect-free); the rebuild check below
    // forces another eviction cycle, so order matters here too.
    expect(manager.getOrCreate('session-1', 'sk-1')).toBe(first);
    const rebuiltSession2 = manager.getOrCreate('session-2', 'sk-2');
    // session-2 was evicted, so this must be a fresh engine.
    expect(rebuiltSession2).not.toBe(first);
  });

  it('touch() resets the idle TTL so an actively-used session survives past the original deadline', async () => {
    manager = makeManager({ idleTtlMs: 20 });
    const engine = manager.getOrCreate('session-a', 'sk-key-a');
    await new Promise((resolve) => setTimeout(resolve, 12));
    manager.touch('session-a');
    await new Promise((resolve) => setTimeout(resolve, 12));
    // 24ms have elapsed since creation (> the original 20ms TTL), but the
    // touch at 12ms reset the deadline to 32ms, so the session must still
    // be present and unchanged.
    expect(manager.size()).toBe(1);
    expect(manager.getOrCreate('session-a', 'sk-key-a')).toBe(engine);
  });

  it('a different apiKey for an existing sessionId evicts and rebuilds instead of reusing the stored key', () => {
    manager = makeManager();
    const original = manager.getOrCreate('session-a', 'sk-original');
    const rebuilt = manager.getOrCreate('session-a', 'sk-different');
    expect(rebuilt).not.toBe(original);
    expect(manager.size()).toBe(1);
  });

  it('evicts a session immediately when evict() is called (socket close)', () => {
    manager = makeManager();
    manager.getOrCreate('session-a', 'sk-key-a');
    expect(manager.size()).toBe(1);
    manager.evict('session-a');
    expect(manager.size()).toBe(0);
  });

  it('evicts a session after the idle TTL elapses', async () => {
    manager = makeManager({ idleTtlMs: 10 });
    manager.getOrCreate('session-a', 'sk-key-a');
    expect(manager.size()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.size()).toBe(0);
  });

  it('never logs or throws the API key in any console output', () => {
    const calls: unknown[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      calls.push(args);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      calls.push(args);
    });

    const throwingManager = new SessionEngineManager({
      maxSessions: 50,
      idleTtlMs: 30 * 60 * 1000,
      systemRules: 'test rules',
      createAdapter: () => {
        throw new Error('boom with key sk-secret-should-never-appear-anywhere');
      },
    });

    const secret = 'sk-secret-should-never-appear-anywhere';
    let thrown: unknown;
    try {
      throwingManager.getOrCreate('session-a', secret);
    } catch (err) {
      thrown = err;
    }

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    throwingManager.dispose();

    const thrownMessage = thrown instanceof Error ? thrown.message : String(thrown);
    expect(thrownMessage).not.toContain(secret);
    for (const call of calls) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });

  it('never logs the API key via the engine.handle → LLM-call-failure path (createEngine\'s default logger)', async () => {
    // Distinct from the construction-failure test above: this exercises the
    // engine's own logger.error('LLM call failed', ...) call, which only
    // happens if SessionEngineManager passed a redacting `logger` into
    // createEngine — the whole point of this fix. If that wiring regressed
    // (config omits `logger`, so createEngine falls back to consoleLogger),
    // this is the test that would catch it; the construction-failure test
    // above can't, because it never reaches the LLM call.
    const calls: unknown[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      calls.push(args);
    });

    const secret = 'sk-secret-should-never-appear-anywhere';
    const throwingAdapter = {
      kind: 'text',
      name: 'fake',
      model: 'fake-model',
      chatStream: () => {
        throw new Error(`upstream rejected key ${secret}`);
      },
      structuredOutput: () => {
        throw new Error(`upstream rejected key ${secret}`);
      },
    } as unknown as AnyTextAdapter;

    manager = new SessionEngineManager({
      maxSessions: 50,
      idleTtlMs: 30 * 60 * 1000,
      systemRules: 'test rules',
      createAdapter: () => throwingAdapter,
    });

    const engine = manager.getOrCreate('session-a', secret);
    await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('session-a'),
        request: MINIMAL_CHART_REQUEST,
      }),
    );

    errorSpy.mockRestore();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });
});
