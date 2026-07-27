import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '@maelstrom-co/client';
import type { ChartRequest } from '@maelstrom-co/protocol';
import { ChartRequestMessage, SessionId } from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SessionCapacityError,
  SessionEngineManager,
} from './session-engine-manager';

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

// ws-server.ts's production heartbeatIntervalMs is this same constant, so
// the liveness window below (2x) matches what actually runs.
const LIVENESS_WINDOW_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * 2;

function makeManager(
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

describe('SessionEngineManager', () => {
  let manager: SessionEngineManager;

  afterEach(() => {
    manager?.dispose();
    vi.useRealTimers();
  });

  it('returns the same engine instance for the same sessionId', () => {
    manager = makeManager();
    const first = manager.getOrCreate('session-a', 'sk-key-a');
    const second = manager.getOrCreate('session-a', 'sk-key-a');
    expect(first).toBe(second);
  });

  it('refuses a new session with SessionCapacityError when every session at capacity is still live', () => {
    // Heartbeats touch() every live session roughly every heartbeat
    // interval, so once the container is full, the "least recently used"
    // session is not necessarily abandoned — it may just be the one that
    // last heartbeat-touched least recently among a room full of open tabs.
    // Evicting it anyway would only relocate the same pressure onto whoever
    // is oldest next, forever. This is the fix: getOrCreate must refuse
    // instead, so the ONE visitor who tried to connect past capacity gets a
    // clear, terminal error while everyone already connected keeps their
    // engine and its history.
    manager = makeManager({ maxSessions: 2 });
    manager.getOrCreate('session-1', 'sk-1');
    manager.getOrCreate('session-2', 'sk-2');

    expect(() => manager.getOrCreate('session-3', 'sk-3')).toThrow(
      SessionCapacityError,
    );
    // Neither existing session was touched to make room for the refused one.
    expect(manager.size()).toBe(2);
    expect(manager.has('session-1')).toBe(true);
    expect(manager.has('session-2')).toBe(true);
  });

  it('evicts the coldest session once it is genuinely stale (older than the liveness window), and the new session succeeds', () => {
    // The LRU cap must still do its job for an abandoned session — only a
    // session a recent heartbeat still vouches for is protected.
    vi.useFakeTimers();
    manager = makeManager({ maxSessions: 2 });
    manager.getOrCreate('session-1', 'sk-1');
    vi.advanceTimersByTime(1_000);
    manager.getOrCreate('session-2', 'sk-2');
    // Pushes session-1 (the oldest, last touched at t=0) past the liveness
    // window; session-2 (touched at t=1_000) is also past it by the time
    // session-3 is created, but that's irrelevant — only the single oldest
    // entry's staleness is ever checked.
    vi.advanceTimersByTime(LIVENESS_WINDOW_MS + 1);

    manager.getOrCreate('session-3', 'sk-3');

    expect(manager.size()).toBe(2);
    expect(manager.has('session-1')).toBe(false);
    expect(manager.has('session-2')).toBe(true);
    expect(manager.has('session-3')).toBe(true);
  });

  it('LRU eviction follows recency (touch), not insertion order, once the picked victim is stale', () => {
    vi.useFakeTimers();
    manager = makeManager({ maxSessions: 2 });
    manager.getOrCreate('session-1', 'sk-1');
    vi.advanceTimersByTime(1_000);
    manager.getOrCreate('session-2', 'sk-2');
    vi.advanceTimersByTime(1_000);
    // Touching session-1 makes session-2 (last touched at t=1_000) the
    // least-recently-used entry from here on, even though session-1 was
    // created first (t=0).
    manager.getOrCreate('session-1', 'sk-1');
    // Pushes session-2's last touch (t=1_000) past the liveness window.
    // session-1's much more recent touch (t=2_000) means it never becomes
    // the eviction candidate -- proof the pick follows recency, not
    // insertion order.
    vi.advanceTimersByTime(LIVENESS_WINDOW_MS + 1);

    manager.getOrCreate('session-3', 'sk-3');

    expect(manager.has('session-1')).toBe(true);
    expect(manager.has('session-2')).toBe(false);
    expect(manager.has('session-3')).toBe(true);
  });

  it('touch() resets the idle TTL so an actively-used session survives past the original deadline', () => {
    vi.useFakeTimers();
    manager = makeManager({ idleTtlMs: 20 });
    const engine = manager.getOrCreate('session-a', 'sk-key-a');
    vi.advanceTimersByTime(12);
    manager.touch('session-a');
    vi.advanceTimersByTime(12);
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

  it('has() reflects whether a session still has a live engine after evict()', () => {
    manager = makeManager();
    manager.getOrCreate('session-a', 'sk-key-a');
    manager.getOrCreate('session-b', 'sk-key-b');
    expect(manager.has('session-a')).toBe(true);
    expect(manager.has('session-b')).toBe(true);

    manager.evict('session-a');

    expect(manager.has('session-a')).toBe(false);
    expect(manager.has('session-b')).toBe(true);
  });

  it('has() is false for a session evicted by the idle TTL', () => {
    vi.useFakeTimers();
    manager = makeManager({ idleTtlMs: 10 });
    manager.getOrCreate('session-a', 'sk-key-a');
    expect(manager.has('session-a')).toBe(true);
    vi.advanceTimersByTime(30);
    expect(manager.has('session-a')).toBe(false);
  });

  it('evicts a session after the idle TTL elapses', () => {
    vi.useFakeTimers();
    manager = makeManager({ idleTtlMs: 10 });
    manager.getOrCreate('session-a', 'sk-key-a');
    expect(manager.size()).toBe(1);
    vi.advanceTimersByTime(30);
    expect(manager.size()).toBe(0);
  });

  it('never logs or throws the API key in any console output', () => {
    const calls: unknown[] = [];
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args) => {
        calls.push(args);
      });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      calls.push(args);
    });

    const throwingManager = new SessionEngineManager({
      maxSessions: 50,
      idleTtlMs: 30 * 60 * 1000,
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
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

    const thrownMessage =
      thrown instanceof Error ? thrown.message : String(thrown);
    expect(thrownMessage).not.toContain(secret);
    for (const call of calls) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });

  it("never logs the API key via the engine.handle → LLM-call-failure path (createEngine's default logger)", async () => {
    // Distinct from the construction-failure test above: this exercises the
    // engine's own logger.error('LLM call failed', ...) call, which only
    // happens if SessionEngineManager passed a redacting `logger` into
    // createEngine — the whole point of this fix. If that wiring regressed
    // (config omits `logger`, so createEngine falls back to consoleLogger),
    // this is the test that would catch it; the construction-failure test
    // above can't, because it never reaches the LLM call.
    const calls: unknown[] = [];
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args) => {
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
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
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
