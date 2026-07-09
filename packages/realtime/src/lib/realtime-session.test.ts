import { describe, expect, it, spyOn } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';
import type { UiStructuralSnapshot } from '@maelstrom-co/client';
import { RequestInFlightError } from '@maelstrom-co/client';
import { InstanceId, SessionId, VariantName, VesselId } from '@maelstrom-co/protocol';
import type { SidechannelEvent } from '@maelstrom-co/protocol';

import type {
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
} from './provider-adapter.types.js';
import type { RealtimeInstance } from './realtime-session.js';
import { RealtimeSession } from './realtime-session.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Mock adapter
// ============================================================================

interface MockAdapter extends RealtimeProviderAdapter {
  readonly toolResults: Array<{ callId: string; output: unknown }>;
  readonly groundingCalls: string[];
  readonly connectCalls: number;
  /** Number of adapter-event handlers currently subscribed via `on()` — a leaked subscription shows up here. */
  readonly listenerCount: number;
  /** Makes the next `connect()` call reject instead of resolving. */
  failNextConnect(): void;
  /** Makes `connect()` block until the returned function is called. */
  gateConnect(): () => void;
  emitToolCall(call: { callId: string; name: string; argumentsJson: string }): void;
}

function makeMockAdapter(): MockAdapter {
  const toolResults: Array<{ callId: string; output: unknown }> = [];
  const groundingCalls: string[] = [];
  const handlers = new Set<(event: RealtimeAdapterEvent) => void>();
  let connectCalls = 0;
  let shouldFailNextConnect = false;
  let gate: Promise<void> | undefined;

  return {
    toolResults,
    groundingCalls,
    get connectCalls() {
      return connectCalls;
    },
    get listenerCount() {
      return handlers.size;
    },
    failNextConnect() {
      shouldFailNextConnect = true;
    },
    gateConnect() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    connect: async () => {
      connectCalls += 1;
      if (gate) {
        await gate;
        gate = undefined;
      }
      if (shouldFailNextConnect) {
        shouldFailNextConnect = false;
        throw new Error('adapter connect failed');
      }
    },
    disconnect: async () => {},
    sendToolResult: async (callId, output) => {
      toolResults.push({ callId, output });
    },
    injectGrounding: (text) => {
      groundingCalls.push(text);
    },
    on: (h) => {
      handlers.add(h);
      return () => {
        handlers.delete(h);
      };
    },
    emitToolCall(call) {
      for (const h of handlers) h({ type: 'tool_call', ...call });
    },
  };
}

// ============================================================================
// Mock instance
// ============================================================================

interface MockInstance extends RealtimeInstance {
  readonly submitted: string[];
  /** Resolves pending waitForIdle() calls and clears the in-flight submitIntent gate — a full render settle. */
  settle(): void;
  /**
   * Resolves pending waitForIdle() calls WITHOUT clearing the in-flight
   * gate — simulates the command queue going idle while the orchestrator's
   * engine round-trip (and thus `RequestInFlightError`) is still ongoing,
   * the exact race the barge-in retry loop is bounded against.
   */
  resolveIdle(): void;
}

function makeMockInstance(snapshot: UiStructuralSnapshot): MockInstance {
  const submitted: string[] = [];
  const settledHandlers = new Set<() => void>();
  let pendingResolvers: Array<() => void> = [];
  let inFlight = false;

  return {
    submitted,
    submitIntent: async (intent: string) => {
      if (inFlight) {
        throw new RequestInFlightError();
      }
      inFlight = true;
      submitted.push(intent);
    },
    waitForIdle: () =>
      new Promise<void>((resolve) => {
        pendingResolvers.push(resolve);
      }),
    getStructuralSnapshot: () => snapshot,
    onSettled: (cb) => {
      settledHandlers.add(cb);
      return () => {
        settledHandlers.delete(cb);
      };
    },
    settle() {
      inFlight = false;
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      for (const resolve of resolvers) resolve();
      for (const cb of settledHandlers) cb();
    },
    resolveIdle() {
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      for (const resolve of resolvers) resolve();
    },
  };
}

const testSessionId = SessionId('sess-test-1');

const emptySnapshot: UiStructuralSnapshot = {
  instances: [],
  layout: null,
  layoutMode: 'grid',
  chartDimensions: { rows: 8, columns: 12 },
};

const populatedSnapshot: UiStructuralSnapshot = {
  instances: [
    {
      instanceId: InstanceId('inst-1'),
      vesselId: VesselId('labs-chart'),
      variant: VariantName('default'),
    },
  ],
  layout: null,
  layoutMode: 'grid',
  chartDimensions: { rows: 8, columns: 12 },
};

function makeHarness(snapshot: UiStructuralSnapshot = emptySnapshot) {
  const adapter = makeMockAdapter();
  const instance = makeMockInstance(snapshot);
  const events: SidechannelEvent[] = [];
  const session = new RealtimeSession({
    adapter,
    instance,
    sessionId: testSessionId,
    onEvent: (e) => events.push(e),
  });
  return { session, adapter, instance, events };
}

// ============================================================================
// Behavior 1: speak-after-render (withhold tool result until settle)
// ============================================================================

describe('RealtimeSession — update_ui speak-after-render', () => {
  it('withholds the update_ui tool-result until the render settles', async () => {
    const { session, adapter, instance } = makeHarness();
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    expect(instance.submitted).toEqual(['show labs']);
    expect(adapter.toolResults).toEqual([]); // not yet — render hasn't settled

    instance.settle();
    await flushMicrotasks();

    expect(adapter.toolResults).toHaveLength(1);
    expect(adapter.toolResults[0].callId).toBe('c1');
    expect(adapter.toolResults[0].output).toEqual({
      summary: expect.any(String),
    });
  });

  it('derives the summary from the POST-settle snapshot, not the pre-call one', async () => {
    const adapter = makeMockAdapter();
    // Snapshot mutates in place between submit and settle, the way a real
    // Orchestrator's live store would — the summary must reflect the value
    // read after settle(), not whatever was true when update_ui fired.
    let liveSnapshot = emptySnapshot;
    const instance = makeMockInstance(emptySnapshot);
    const wrappedInstance: RealtimeInstance = {
      ...instance,
      getStructuralSnapshot: () => liveSnapshot,
    };
    const session = new RealtimeSession({
      adapter,
      instance: wrappedInstance,
      sessionId: testSessionId,
    });
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    liveSnapshot = populatedSnapshot;
    instance.settle();
    await flushMicrotasks();

    expect(adapter.toolResults[0].output).toEqual({
      summary: expect.stringContaining('labs-chart'),
    });
  });
});

// ============================================================================
// Behavior 2: get_ui_state answers immediately
// ============================================================================

describe('RealtimeSession — get_ui_state', () => {
  it('answers immediately with the structural snapshot, no intent involved', async () => {
    const { session, adapter, instance } = makeHarness(populatedSnapshot);
    await session.connect();

    adapter.emitToolCall({ callId: 'c2', name: 'get_ui_state', argumentsJson: '{}' });
    await flushMicrotasks();

    expect(instance.submitted).toEqual([]); // no engine round-trip
    expect(adapter.toolResults).toHaveLength(1);
    expect(adapter.toolResults[0]).toEqual({
      callId: 'c2',
      output: populatedSnapshot,
    });
  });
});

// ============================================================================
// Behavior 3: grounding — debounced, latest-wins
// ============================================================================

describe('RealtimeSession — grounding debounce', () => {
  it('collapses rapid settles into a single latest-wins grounding push', async () => {
    // Real timers here (not fake) since we only assert ordering/count, not
    // exact timing — groundedDebounce itself is separately verified against
    // fake timers in grounding-debounce.test.ts.
    let liveSnapshot = emptySnapshot;
    const adapter = makeMockAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const wrappedInstance: RealtimeInstance = {
      ...instance,
      getStructuralSnapshot: () => liveSnapshot,
    };
    const session = new RealtimeSession({
      adapter,
      instance: wrappedInstance,
      sessionId: testSessionId,
      groundingDebounceMs: 20,
    });
    await session.connect();

    // The final settle's snapshot must be distinguishable from the middle
    // one (both otherwise contain 'labs-chart') so the assertion below
    // proves latest-wins rather than coincidentally matching either.
    const finalSnapshot: UiStructuralSnapshot = {
      ...populatedSnapshot,
      layoutMode: 'tiling',
    };

    liveSnapshot = { ...emptySnapshot, layoutMode: 'grid' };
    instance.settle();
    liveSnapshot = populatedSnapshot;
    instance.settle();
    liveSnapshot = finalSnapshot;
    instance.settle();

    expect(adapter.groundingCalls).toEqual([]); // debounced, nothing yet

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(adapter.groundingCalls).toHaveLength(1);
    expect(adapter.groundingCalls[0]).toContain('labs-chart');
    expect(adapter.groundingCalls[0]).toContain('tiling');
  });
});

// ============================================================================
// Behavior 3a: grounding only subscribed once connected
// ============================================================================

describe('RealtimeSession — grounding subscription timing', () => {
  it('never grounds on a settle fired during the connect() handshake, but does ground on a settle after connect resolves', async () => {
    const adapter = makeMockAdapter();
    const instance = makeMockInstance(populatedSnapshot);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      groundingDebounceMs: 0,
    });

    const release = adapter.gateConnect();
    const connectPromise = session.connect();
    await flushMicrotasks();
    expect(session.state).toBe('connecting');

    // Settle fires mid-handshake — the data channel would still be closed at
    // this point in the real adapter, so this push must never be scheduled.
    instance.settle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.groundingCalls).toEqual([]);

    release();
    await connectPromise;
    expect(session.state).toBe('connected');

    // A settle after connect resolves must ground normally.
    instance.settle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.groundingCalls).toHaveLength(1);
  });
});

// ============================================================================
// Behavior 3b: grounding length clamp
// ============================================================================

describe('RealtimeSession — grounding length clamp', () => {
  it('clamps a grounding push exceeding the char budget to 400 chars ending in an ellipsis', async () => {
    const adapter = makeMockAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const longSummary = 'x'.repeat(500);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      groundingDebounceMs: 0,
      summarize: () => longSummary,
    });
    await session.connect();

    instance.settle();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adapter.groundingCalls).toHaveLength(1);
    expect(adapter.groundingCalls[0]).toHaveLength(400);
    expect(adapter.groundingCalls[0]).toBe(`${'x'.repeat(399)}…`);
  });

  it('passes a grounding summary within the char budget through untouched', async () => {
    const adapter = makeMockAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const shortSummary = 'short summary';
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      groundingDebounceMs: 0,
      summarize: () => shortSummary,
    });
    await session.connect();

    instance.settle();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adapter.groundingCalls).toEqual([shortSummary]);
  });

  it('warns on the first clamp and only debug-logs subsequent clamps in the same session', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const adapter = makeMockAdapter();
      const instance = makeMockInstance(emptySnapshot);
      const longSummary = 'x'.repeat(500);
      const session = new RealtimeSession({
        adapter,
        instance,
        sessionId: testSessionId,
        groundingDebounceMs: 0,
        summarize: () => longSummary,
        debug: true, // logger.debug is a no-op unless enabled
      });
      await session.connect();

      instance.settle();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('grounding text exceeded'),
        expect.anything(),
      );

      instance.settle();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(warnSpy).toHaveBeenCalledTimes(1); // still just once
      expect(debugSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('grounding text exceeded'),
        expect.anything(),
      );
    } finally {
      warnSpy.mockRestore();
      debugSpy.mockRestore();
    }
  });
});

// ============================================================================
// Behavior 4: domain-data boundary
// ============================================================================

describe('RealtimeSession — domain-data boundary', () => {
  it('passes submitIntent only the plain intent string', async () => {
    const { session, adapter, instance } = makeHarness();
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    expect(instance.submitted).toEqual(['show labs']);
    expect(typeof instance.submitted[0]).toBe('string');
  });

  it('the get_ui_state snapshot carries only structural keys, no vessel contents', async () => {
    const { session, adapter } = makeHarness(populatedSnapshot);
    await session.connect();

    adapter.emitToolCall({ callId: 'c2', name: 'get_ui_state', argumentsJson: '{}' });
    await flushMicrotasks();

    const output = adapter.toolResults[0].output as UiStructuralSnapshot;
    expect(Object.keys(output).sort()).toEqual(
      ['chartDimensions', 'instances', 'layout', 'layoutMode'].sort(),
    );
    for (const instance of output.instances) {
      expect(Object.keys(instance).sort()).toEqual(
        ['instanceId', 'vesselId', 'variant'].sort(),
      );
    }
  });
});

// ============================================================================
// Behavior 5: barge-in latest-wins queueing
// ============================================================================

describe('RealtimeSession — barge-in latest-wins queueing', () => {
  it('queues a concurrent update_ui instead of answering busy immediately, then applies it once the first settles', async () => {
    const { session, adapter, instance, events } = makeHarness();
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    // Second update_ui fires while the first is still unsettled — the
    // MockInstance simulates Orchestrator.processIntent's in-flight guard by
    // throwing here.
    adapter.emitToolCall({
      callId: 'c2',
      name: 'update_ui',
      argumentsJson: '{"intent":"show revenue"}',
    });
    await flushMicrotasks();

    // Never reached the instance yet, and not answered busy — queued instead.
    expect(instance.submitted).toEqual(['show labs']);
    expect(adapter.toolResults.find((r) => r.callId === 'c2')).toBeUndefined();

    // First settle finalizes c1 and lets the queued c2 make its (successful)
    // retry attempt against the now-idle instance.
    instance.settle();
    await flushMicrotasks();
    expect(instance.submitted).toEqual(['show labs', 'show revenue']);

    // Second settle finalizes c2's own render.
    instance.settle();
    await flushMicrotasks();

    const c1Result = adapter.toolResults.find((r) => r.callId === 'c1');
    const c2Result = adapter.toolResults.find((r) => r.callId === 'c2');
    expect(c1Result?.output).toEqual({ summary: expect.any(String) });
    expect(c2Result?.output).toEqual({ summary: expect.any(String) });

    // Exactly one sendToolResult + one tool_result sidechannel event per callId.
    expect(adapter.toolResults.filter((r) => r.callId === 'c1')).toHaveLength(1);
    expect(adapter.toolResults.filter((r) => r.callId === 'c2')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool_result' && e.callId === 'c1')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool_result' && e.callId === 'c2')).toHaveLength(1);
  });

  it('supersedes a queued call with a newer one, answering the bumped call immediately', async () => {
    const { session, adapter, instance, events } = makeHarness();
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    adapter.emitToolCall({
      callId: 'c2',
      name: 'update_ui',
      argumentsJson: '{"intent":"show revenue"}',
    });
    await flushMicrotasks();

    // Third call arrives while c2 is still just queued (c1 hasn't settled) —
    // c2 gets bumped and answered right away, without waiting on a settle.
    adapter.emitToolCall({
      callId: 'c3',
      name: 'update_ui',
      argumentsJson: '{"intent":"show pipeline"}',
    });
    await flushMicrotasks();

    const c2Result = adapter.toolResults.find((r) => r.callId === 'c2');
    expect(c2Result?.output).toEqual({
      ok: false,
      summary: 'Superseded by a newer request.',
    });
    expect(instance.submitted).toEqual(['show labs']); // neither c2 nor c3 has reached the instance yet

    // Settle 1: finalizes c1, and wakes the retry loop — which discovers c2
    // was superseded and moves on to attempt c3 fresh.
    instance.settle();
    await flushMicrotasks();
    // Settle 2: lets c3's first retry attempt actually submit.
    instance.settle();
    await flushMicrotasks();
    expect(instance.submitted).toEqual(['show labs', 'show pipeline']);
    // Settle 3: finalizes c3's own render.
    instance.settle();
    await flushMicrotasks();

    const c3Result = adapter.toolResults.find((r) => r.callId === 'c3');
    expect(c3Result?.output).toEqual({ summary: expect.any(String) });

    // Exactly one answer + one sidechannel event per callId, even for the superseded one.
    for (const callId of ['c1', 'c2', 'c3']) {
      expect(adapter.toolResults.filter((r) => r.callId === callId)).toHaveLength(1);
      expect(events.filter((e) => e.type === 'tool_result' && e.callId === callId)).toHaveLength(
        1,
      );
    }
  });

  it('answers busy after exhausting bounded retry attempts, without ever applying the queued intent', async () => {
    // Simulates waitForIdle() resolving (command queue idle) while
    // submitIntent still throws RequestInFlightError each time — the exact
    // race the retry loop is bounded against, since the engine round-trip
    // for the first intent never actually finishes in this scenario.
    const clock = FakeTimers.install();
    try {
      const { session, adapter, instance } = makeHarness();
      await session.connect();

      adapter.emitToolCall({
        callId: 'c1',
        name: 'update_ui',
        argumentsJson: '{"intent":"show labs"}',
      });
      await clock.tickAsync(0);
      expect(instance.submitted).toEqual(['show labs']);

      adapter.emitToolCall({
        callId: 'c2',
        name: 'update_ui',
        argumentsJson: '{"intent":"show revenue"}',
      });
      await clock.tickAsync(0);

      const maxAttempts = 5; // mirrors MAX_BARGE_IN_ATTEMPTS in realtime-session.ts
      const retryDelayMs = 200; // mirrors BARGE_IN_RETRY_DELAY_MS in realtime-session.ts
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        instance.resolveIdle();
        await clock.tickAsync(0);
        if (attempt < maxAttempts) {
          await clock.tickAsync(retryDelayMs);
        }
      }

      const c2Result = adapter.toolResults.find((r) => r.callId === 'c2');
      expect(c2Result?.output).toEqual({
        ok: false,
        summary: 'Still applying the previous change — try again in a moment.',
      });
      expect(instance.submitted).toEqual(['show labs']); // c2 never got through
    } finally {
      clock.uninstall();
    }
  });

  it('a genuine failure during a queued retry still yields APPLY_FAILED_SUMMARY, not a busy answer', async () => {
    // NOT the in-flight guard: c2 queues on its first attempt (busy), but its
    // retry attempt hits a genuine pipeline error — must not be mislabeled
    // as "try again", since that would be a non-recovering retry loop.
    const adapter = makeMockAdapter();
    const events: SidechannelEvent[] = [];
    const idleResolvers: Array<() => void> = [];
    let submitCalls = 0;
    const instance: RealtimeInstance = {
      submitIntent: async () => {
        submitCalls += 1;
        if (submitCalls === 1) return; // c1 submits fine
        if (submitCalls === 2) throw new RequestInFlightError(); // c2's first attempt: busy, gets queued
        throw new Error('render pipeline exploded'); // c2's retry attempt: genuine failure
      },
      waitForIdle: () =>
        new Promise<void>((resolve) => {
          idleResolvers.push(resolve);
        }),
      getStructuralSnapshot: () => emptySnapshot,
      onSettled: () => () => {},
    };
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      onEvent: (e) => events.push(e),
    });
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    adapter.emitToolCall({
      callId: 'c2',
      name: 'update_ui',
      argumentsJson: '{"intent":"show revenue"}',
    });
    await flushMicrotasks();

    // Resolve both c1's own wait and c2's retry-loop wait.
    for (const resolve of idleResolvers.splice(0)) resolve();
    await flushMicrotasks();

    const c2Result = adapter.toolResults.find((r) => r.callId === 'c2');
    expect(c2Result?.output).toEqual({
      ok: false,
      summary: 'Something went wrong applying that change.',
    });

    const errorTiming = events.find(
      (e) => e.type === 'timing' && e.label === 'update_ui.error',
    );
    expect(errorTiming).toBeDefined();
  });

  it('surfaces a non-busy rejection distinctly instead of mislabeling it as busy', async () => {
    // A genuine render/pipeline failure — NOT the in-flight guard — must not
    // be reported with BUSY_SUMMARY, since that would tell the model to
    // "just try again" forever on an error that will never self-resolve.
    const adapter = makeMockAdapter();
    const events: SidechannelEvent[] = [];
    const instance: RealtimeInstance = {
      submitIntent: async () => {
        throw new Error('render pipeline exploded');
      },
      waitForIdle: async () => {},
      getStructuralSnapshot: () => emptySnapshot,
      onSettled: () => () => {},
    };
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      onEvent: (e) => events.push(e),
    });
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    expect(adapter.toolResults).toHaveLength(1);
    const result = adapter.toolResults[0];
    const output = result.output as { ok: boolean; summary: string };
    expect(output.ok).toBe(false);
    expect(output.summary).not.toContain('try again');
    expect(output.summary).not.toBe(
      'Still applying the previous change — try again in a moment.',
    );

    const errorTiming = events.find(
      (e) => e.type === 'timing' && e.label === 'update_ui.error',
    );
    expect(errorTiming).toBeDefined();
  });
});

// ============================================================================
// Behavior 6: sidechannel events
// ============================================================================

describe('RealtimeSession — sidechannel events', () => {
  it('emits a matching tool_call -> tool_result pair with a measured latencyMs', async () => {
    const { session, adapter, events } = makeHarness();
    await session.connect();

    adapter.emitToolCall({ callId: 'c1', name: 'get_ui_state', argumentsJson: '{}' });
    await flushMicrotasks();

    const call = events.find((e) => e.type === 'tool_call');
    const result = events.find((e) => e.type === 'tool_result');
    expect(call).toBeDefined();
    expect(result).toBeDefined();
    if (call?.type === 'tool_call' && result?.type === 'tool_result') {
      expect(call.callId).toBe('c1');
      expect(result.callId).toBe('c1');
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(call.sessionId).toBe(testSessionId);
      expect(result.sessionId).toBe(testSessionId);
    }
  });
});

// ============================================================================
// Behavior 7: connection lifecycle — state transitions, re-entry, cleanup
// ============================================================================

describe('RealtimeSession — connection lifecycle', () => {
  it('transitions connecting -> connected on success, and connected -> idle on disconnect', async () => {
    const { session } = makeHarness();
    const states: string[] = [];
    session.on('state', (s) => states.push(s));

    await session.connect();
    expect(states).toEqual(['connecting', 'connected']);
    expect(session.state).toBe('connected');

    await session.disconnect();
    expect(states).toEqual(['connecting', 'connected', 'idle']);
    expect(session.state).toBe('idle');
  });

  it('transitions connecting -> error and rethrows when adapter.connect rejects', async () => {
    const { session, adapter } = makeHarness();
    adapter.failNextConnect();
    const states: string[] = [];
    session.on('state', (s) => states.push(s));

    let thrown: unknown;
    try {
      await session.connect();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(states).toEqual(['connecting', 'error']);
    expect(session.state).toBe('error');
  });

  it('is a no-op when connect() is called again while already connected', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    expect(adapter.connectCalls).toBe(1);

    await session.connect();
    expect(adapter.connectCalls).toBe(1); // no second connect attempt
    expect(session.state).toBe('connected');
  });

  it('is a no-op when connect() is called again while still connecting', async () => {
    const { session, adapter } = makeHarness();
    const release = adapter.gateConnect();

    const firstConnect = session.connect();
    await flushMicrotasks();
    expect(session.state).toBe('connecting');

    await session.connect(); // guarded: state is 'connecting'
    expect(adapter.connectCalls).toBe(1);

    release();
    await firstConnect;
    expect(session.state).toBe('connected');
    expect(adapter.connectCalls).toBe(1);
  });

  it('tears down subscriptions on a failed connect so a stale settle never reaches the adapter', async () => {
    const { session, adapter, instance } = makeHarness();
    adapter.failNextConnect();

    try {
      await session.connect();
    } catch {
      // asserted via state in the prior test — only cleanup matters here.
    }

    expect(adapter.listenerCount).toBe(0);

    // A settle firing after the failed connect must not reach the adapter —
    // the onSettled subscription installed before the rejection was torn
    // down in the failure-cleanup path.
    instance.settle();
    await flushMicrotasks();
    expect(adapter.groundingCalls).toEqual([]);
  });

  it('retries cleanly after a failed connect — exactly one subscription, no double-handling', async () => {
    const { session, adapter } = makeHarness();
    adapter.failNextConnect();

    try {
      await session.connect();
    } catch {
      // expected — see the dedicated error-transition test above.
    }
    expect(session.state).toBe('error');
    expect(adapter.listenerCount).toBe(0);

    await session.connect(); // retry succeeds
    expect(session.state).toBe('connected');
    expect(adapter.listenerCount).toBe(1);
    expect(adapter.connectCalls).toBe(2);

    adapter.emitToolCall({ callId: 'c1', name: 'get_ui_state', argumentsJson: '{}' });
    await flushMicrotasks();

    // Exactly one tool_result — a leaked handler from the failed attempt
    // would have produced two.
    expect(adapter.toolResults).toHaveLength(1);
  });

  it('disconnect cancels a pending debounced grounding push so it cannot land after teardown', async () => {
    const adapter = makeMockAdapter();
    const instance = makeMockInstance(populatedSnapshot);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      groundingDebounceMs: 20,
    });
    await session.connect();

    instance.settle(); // schedules a debounced grounding push ~20ms out
    await session.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(adapter.groundingCalls).toEqual([]);
  });

  it('disconnect drops a pending queued intent silently instead of leaving it dangling with an unhandled rejection', async () => {
    const { session, adapter, instance } = makeHarness();
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    adapter.emitToolCall({
      callId: 'c2',
      name: 'update_ui',
      argumentsJson: '{"intent":"show revenue"}',
    });
    await flushMicrotasks(); // c2 is now queued, waiting on c1

    await session.disconnect();

    // A settle firing after disconnect must not answer the dropped call —
    // the whole point is silent drop, not a late busy/superseded answer.
    instance.settle();
    await flushMicrotasks();

    expect(adapter.toolResults.find((r) => r.callId === 'c2')).toBeUndefined();
  });
});
