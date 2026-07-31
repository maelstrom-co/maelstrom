import { describe, expect, it, spyOn } from 'bun:test';
import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
  VoiceSession,
} from '@maelstrom-co/client';
import { RequestInFlightError } from '@maelstrom-co/client';
import type { SidechannelEvent } from '@maelstrom-co/protocol';
import {
  ActionName,
  InstanceId,
  SessionId,
  ToolCallId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { RealtimeVoiceError } from '../realtime-voice-error.js';
import type {
  AdapterAudioStreams,
  AdapterTurnControl,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
  TurnModeEvent,
  UpdateUIToolResult,
} from './provider-adapter.types.js';
import { RealtimeSession } from './realtime-session.js';
import type {
  RealtimeInstance,
  SubmitIntentResult,
} from './realtime-session.types.js';

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
  readonly disconnectCalls: number;
  /** Tools passed to the most recent `connect()` call. */
  readonly lastConnectTools: readonly RealtimeToolSpec[] | undefined;
  /** Number of adapter-event handlers currently subscribed via `on()` — a leaked subscription shows up here. */
  readonly listenerCount: number;
  /** Makes the next `connect()` call reject instead of resolving. */
  failNextConnect(): void;
  /** Makes `connect()` block until the returned function is called. */
  gateConnect(): () => void;
  emitToolCall(call: {
    callId: string;
    name: string;
    argumentsJson: string;
  }): void;
  emitError(error: unknown): void;
  emitTranscript(t: {
    role: 'user' | 'assistant';
    text: string;
    final: boolean;
  }): void;
  emitTurnMode(mode: 'automatic' | 'manual', error?: unknown): void;
  setTurnControl(turnControl: AdapterTurnControl | undefined): void;
  /** Sentinel returned by `getAudioStreams()` — identity-compared by tests. */
  readonly lastAudioStreams: AdapterAudioStreams;
}

function makeMockAdapter(): MockAdapter {
  const toolResults: Array<{ callId: string; output: unknown }> = [];
  const groundingCalls: string[] = [];
  const handlers = new Set<(event: RealtimeAdapterEvent) => void>();
  let connectCalls = 0;
  let disconnectCalls = 0;
  let lastConnectTools: readonly RealtimeToolSpec[] | undefined;
  let shouldFailNextConnect = false;
  let gate: Promise<void> | undefined;
  let turnControl: AdapterTurnControl | undefined;
  const lastAudioStreams: AdapterAudioStreams = {};

  return {
    toolResults,
    groundingCalls,
    lastAudioStreams,
    getAudioStreams: () => lastAudioStreams,
    get connectCalls() {
      return connectCalls;
    },
    get disconnectCalls() {
      return disconnectCalls;
    },
    get lastConnectTools() {
      return lastConnectTools;
    },
    get listenerCount() {
      return handlers.size;
    },
    get turnControl() {
      return turnControl;
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
    connect: async (opts) => {
      connectCalls += 1;
      lastConnectTools = opts.tools;
      if (gate) {
        await gate;
        gate = undefined;
      }
      if (shouldFailNextConnect) {
        shouldFailNextConnect = false;
        throw new Error('adapter connect failed');
      }
    },
    disconnect: async () => {
      disconnectCalls += 1;
    },
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
      for (const h of handlers) {
        h({ type: 'tool_call', ...call, callId: ToolCallId(call.callId) });
      }
    },
    emitError(error) {
      for (const h of handlers) h({ type: 'error', error });
    },
    emitTranscript(t) {
      for (const h of handlers) h({ type: 'transcript', ...t });
    },
    emitTurnMode(mode, error) {
      for (const h of handlers) h({ type: 'turn_mode', mode, error });
    },
    setTurnControl(next) {
      turnControl = next;
    },
  };
}

// ============================================================================
// Mock instance
// ============================================================================

const emptyCapabilitySnapshot: CapabilitySnapshot = { vessels: [] };

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
  /** Number of onSettled subscribers currently registered — a leaked subscription shows up here. */
  readonly settledSubscriberCount: number;
}

function makeMockInstance(
  snapshot: UIStructuralSnapshot,
  capabilitySnapshot: CapabilitySnapshot = emptyCapabilitySnapshot,
  submitResult: SubmitIntentResult = {},
): MockInstance {
  const submitted: string[] = [];
  const settledHandlers = new Set<() => void>();
  let pendingResolvers: Array<() => void> = [];
  let inFlight = false;

  return {
    submitted,
    get settledSubscriberCount() {
      return settledHandlers.size;
    },
    submitIntent: async (intent: string) => {
      if (inFlight) {
        throw new RequestInFlightError();
      }
      inFlight = true;
      submitted.push(intent);
      return submitResult;
    },
    waitForIdle: () =>
      new Promise<void>((resolve) => {
        pendingResolvers.push(resolve);
      }),
    getStructuralSnapshot: () => snapshot,
    getCapabilitySnapshot: () => capabilitySnapshot,
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

const emptySnapshot: UIStructuralSnapshot = {
  instances: [],
  layout: null,
  layoutMode: 'grid',
  chartDimensions: { rows: 8, columns: 12 },
};

const populatedSnapshot: UIStructuralSnapshot = {
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

const populatedCapabilitySnapshot: CapabilitySnapshot = {
  vessels: [
    {
      vesselId: VesselId('labs-chart'),
      description: 'A chart of lab results over time',
      variants: [
        { name: VariantName('default'), description: 'Standard view' },
      ],
      actions: [
        { name: ActionName('zoom'), description: 'Zoom into a date range' },
      ],
    },
  ],
};

function makeHarness(
  snapshot: UIStructuralSnapshot = emptySnapshot,
  capabilitySnapshot: CapabilitySnapshot = emptyCapabilitySnapshot,
  submitResult: SubmitIntentResult = {},
) {
  const adapter = makeMockAdapter();
  const instance = makeMockInstance(snapshot, capabilitySnapshot, submitResult);
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
// Behavior 0: tool registration
// ============================================================================

describe('RealtimeSession — tool registration', () => {
  it('passes update_ui, get_ui_state, and get_capabilities to the adapter on connect', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();

    expect(adapter.lastConnectTools?.map((t) => t.name)).toEqual([
      'update_ui',
      'get_ui_state',
      'get_capabilities',
    ]);
  });
});

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
      ok: true,
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
      ok: true,
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

    adapter.emitToolCall({
      callId: 'c2',
      name: 'get_ui_state',
      argumentsJson: '{}',
    });
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
// Behavior 2a: get_capabilities answers immediately
// ============================================================================

describe('RealtimeSession — get_capabilities', () => {
  it('answers immediately with the capability snapshot, no intent involved', async () => {
    const { session, adapter, instance } = makeHarness(
      emptySnapshot,
      populatedCapabilitySnapshot,
    );
    await session.connect();

    adapter.emitToolCall({
      callId: 'c3',
      name: 'get_capabilities',
      argumentsJson: '{}',
    });
    await flushMicrotasks();

    // Pure read: neither an engine round-trip nor a wait on the barge-in
    // queue — if the handler awaited waitForIdle() it would hang forever
    // here, since nothing in this test calls settle()/resolveIdle().
    expect(instance.submitted).toEqual([]);
    expect(adapter.toolResults).toHaveLength(1);
    expect(adapter.toolResults[0]).toEqual({
      callId: 'c3',
      output: populatedCapabilitySnapshot,
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
    const finalSnapshot: UIStructuralSnapshot = {
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

    adapter.emitToolCall({
      callId: 'c2',
      name: 'get_ui_state',
      argumentsJson: '{}',
    });
    await flushMicrotasks();

    const output = adapter.toolResults[0].output as UIStructuralSnapshot;
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
    expect(c1Result?.output).toEqual({ ok: true, summary: expect.any(String) });
    expect(c2Result?.output).toEqual({ ok: true, summary: expect.any(String) });

    // Exactly one sendToolResult + one tool_result sidechannel event per callId.
    expect(adapter.toolResults.filter((r) => r.callId === 'c1')).toHaveLength(
      1,
    );
    expect(adapter.toolResults.filter((r) => r.callId === 'c2')).toHaveLength(
      1,
    );
    expect(
      events.filter((e) => e.type === 'tool_result' && e.callId === 'c1'),
    ).toHaveLength(1);
    expect(
      events.filter((e) => e.type === 'tool_result' && e.callId === 'c2'),
    ).toHaveLength(1);
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
    expect(c3Result?.output).toEqual({ ok: true, summary: expect.any(String) });

    // Exactly one answer + one sidechannel event per callId, even for the superseded one.
    for (const callId of ['c1', 'c2', 'c3']) {
      expect(
        adapter.toolResults.filter((r) => r.callId === callId),
      ).toHaveLength(1);
      expect(
        events.filter((e) => e.type === 'tool_result' && e.callId === callId),
      ).toHaveLength(1);
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
        if (submitCalls === 1) return {}; // c1 submits fine
        if (submitCalls === 2) throw new RequestInFlightError(); // c2's first attempt: busy, gets queued
        throw new Error('render pipeline exploded'); // c2's retry attempt: genuine failure
      },
      waitForIdle: () =>
        new Promise<void>((resolve) => {
          idleResolvers.push(resolve);
        }),
      getStructuralSnapshot: () => emptySnapshot,
      getCapabilitySnapshot: () => emptyCapabilitySnapshot,
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

  it('queues a barge-in when the instance throws a duck-typed request_in_flight error, not just a real RequestInFlightError instance', async () => {
    // Dual-package hazard: an external consumer with a mismatched
    // @maelstrom-co/client copy would have `instanceof RequestInFlightError`
    // silently false even for a genuine in-flight rejection. The session
    // must also recognize a plain object carrying the stable `code`.
    const adapter = makeMockAdapter();
    const events: SidechannelEvent[] = [];
    const idleResolvers: Array<() => void> = [];
    let submitCalls = 0;
    const instance: RealtimeInstance = {
      submitIntent: async () => {
        submitCalls += 1;
        if (submitCalls === 1) return {}; // c1 submits fine
        if (submitCalls === 2) {
          // NOT `instanceof RequestInFlightError` — a duck-typed lookalike,
          // as would cross a mismatched package boundary.
          throw { code: 'request_in_flight' };
        }
        return {}; // c2's retry succeeds
      },
      waitForIdle: () =>
        new Promise<void>((resolve) => {
          idleResolvers.push(resolve);
        }),
      getStructuralSnapshot: () => populatedSnapshot,
      getCapabilitySnapshot: () => emptyCapabilitySnapshot,
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

    // Not answered yet — queued as a barge-in, exactly as a real
    // RequestInFlightError would be.
    expect(adapter.toolResults.find((r) => r.callId === 'c2')).toBeUndefined();

    // Resolve c1's own wait and c2's retry-loop wait.
    for (const resolve of idleResolvers.splice(0)) resolve();
    await flushMicrotasks();
    // Resolve c2's post-submit wait for its own render to settle.
    for (const resolve of idleResolvers.splice(0)) resolve();
    await flushMicrotasks();

    const c2Result = adapter.toolResults.find((r) => r.callId === 'c2');
    expect(c2Result?.output).toEqual({ ok: true, summary: expect.any(String) });
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
      getCapabilitySnapshot: () => emptyCapabilitySnapshot,
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
// Behavior 4a: a legacy instance resolving void must not wedge the session
// ============================================================================

describe('RealtimeSession — defensive outcome normalization', () => {
  it('treats an undefined submitIntent resolution as {} on the direct call path, instead of throwing', async () => {
    const adapter = makeMockAdapter();
    const events: SidechannelEvent[] = [];
    const idleResolvers: Array<() => void> = [];
    const instance: RealtimeInstance = {
      submitIntent: async () => undefined as unknown as SubmitIntentResult,
      waitForIdle: () =>
        new Promise<void>((resolve) => {
          idleResolvers.push(resolve);
        }),
      getStructuralSnapshot: () => populatedSnapshot,
      getCapabilitySnapshot: () => emptyCapabilitySnapshot,
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

    for (const resolve of idleResolvers.splice(0)) resolve();
    await flushMicrotasks();

    const c1Result = adapter.toolResults.find((r) => r.callId === 'c1');
    expect(c1Result?.output).toEqual({ ok: true, summary: expect.any(String) });
  });

  it('treats an undefined submitIntent resolution as {} on the barge-in retry path, instead of throwing', async () => {
    const adapter = makeMockAdapter();
    const events: SidechannelEvent[] = [];
    const idleResolvers: Array<() => void> = [];
    let submitCalls = 0;
    const instance: RealtimeInstance = {
      submitIntent: async () => {
        submitCalls += 1;
        if (submitCalls === 1) return {}; // c1 submits fine
        if (submitCalls === 2) throw new RequestInFlightError(); // c2's first attempt: busy, gets queued
        // c2's retry attempt: a legacy instance resolving void.
        return undefined as unknown as SubmitIntentResult;
      },
      waitForIdle: () =>
        new Promise<void>((resolve) => {
          idleResolvers.push(resolve);
        }),
      getStructuralSnapshot: () => populatedSnapshot,
      getCapabilitySnapshot: () => emptyCapabilitySnapshot,
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

    // Resolve c1's own wait and c2's retry-loop wait.
    for (const resolve of idleResolvers.splice(0)) resolve();
    await flushMicrotasks();
    // Resolve c2's post-submit wait for its own render to settle.
    for (const resolve of idleResolvers.splice(0)) resolve();
    await flushMicrotasks();

    const c2Result = adapter.toolResults.find((r) => r.callId === 'c2');
    expect(c2Result?.output).toEqual({ ok: true, summary: expect.any(String) });
  });
});

// ============================================================================
// Behavior 5a: engine userMessage is the spoken reply
// ============================================================================

describe('RealtimeSession — engine userMessage precedence', () => {
  it('carries the engine userMessage alongside the structural summary', async () => {
    const engineReply = "I'm doing well, thank you for asking!";
    // populatedSnapshot summarizes to a "1 vessel on screen…" structural
    // sentence; that still travels as `summary`, but the engine reply travels
    // as `userMessage` so a consuming adapter can prefer it.
    const { session, adapter, instance } = makeHarness(
      populatedSnapshot,
      emptyCapabilitySnapshot,
      { userMessage: engineReply },
    );
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"how are you"}',
    });
    await flushMicrotasks();
    instance.settle();
    await flushMicrotasks();

    const output = adapter.toolResults[0].output as UpdateUIToolResult;
    expect(output.ok).toBe(true);
    expect(output.userMessage).toBe(engineReply);
    // The structural summary is not collapsed away — it rides along as the
    // fallback, distinct from the engine reply.
    expect(output.summary).toEqual(expect.any(String));
    expect(output.summary).not.toBe(engineReply);
  });

  it('omits userMessage so the summary is the fallback when the engine surfaces none', async () => {
    // Empty (whitespace-only) userMessage is treated as absent — fall back.
    const { session, adapter, instance } = makeHarness(
      populatedSnapshot,
      emptyCapabilitySnapshot,
      { userMessage: '   ' },
    );
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();
    instance.settle();
    await flushMicrotasks();

    const output = adapter.toolResults[0].output as UpdateUIToolResult;
    expect(output.ok).toBe(true);
    expect(output.userMessage).toBeUndefined(); // whitespace-only reply omitted
    expect(output.summary).toContain('labs-chart'); // the default summarizer ran
  });

  it('carries the engine reply distinct from a structural summary that would miscount hidden instances', async () => {
    // The structural summarizer counts every instance in the snapshot,
    // including ones a tiling layout keeps alive but off-screen — so it would
    // say "3 vessels on screen" even when fewer are visible. The engine's
    // userMessage, which knows what actually rendered, is the field a consuming
    // adapter prefers, so the miscount never reaches the user.
    const threeInstanceSnapshot: UIStructuralSnapshot = {
      instances: [
        {
          instanceId: InstanceId('inst-1'),
          vesselId: VesselId('labs-chart'),
          variant: VariantName('default'),
        },
        {
          instanceId: InstanceId('inst-2'),
          vesselId: VesselId('revenue-chart'),
          variant: VariantName('default'),
        },
        {
          instanceId: InstanceId('inst-3'),
          vesselId: VesselId('pipeline-chart'),
          variant: VariantName('default'),
        },
      ],
      layout: null,
      layoutMode: 'tiling',
      chartDimensions: { rows: 8, columns: 12 },
    };
    const engineReply = 'Showing your labs.';
    const { session, adapter, instance } = makeHarness(
      threeInstanceSnapshot,
      emptyCapabilitySnapshot,
      { userMessage: engineReply },
    );
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();
    instance.settle();
    await flushMicrotasks();

    const output = adapter.toolResults[0].output as UpdateUIToolResult;
    expect(output.userMessage).toBe(engineReply);
    expect(output.userMessage).not.toContain('3 vessels');
  });

  it('speaks the engine reply for a barge-in queued call too, not just the first', async () => {
    const engineReply = 'Done — revenue is up.';
    const { session, adapter, instance } = makeHarness(
      populatedSnapshot,
      emptyCapabilitySnapshot,
      { userMessage: engineReply },
    );
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();

    // c2 arrives while c1 is unsettled — queued as a barge-in and applied via
    // the retry loop once c1 settles.
    adapter.emitToolCall({
      callId: 'c2',
      name: 'update_ui',
      argumentsJson: '{"intent":"show revenue"}',
    });
    await flushMicrotasks();

    instance.settle(); // finalizes c1, lets c2 retry-submit
    await flushMicrotasks();
    instance.settle(); // finalizes c2's own render
    await flushMicrotasks();

    const c2Result = adapter.toolResults.find((r) => r.callId === 'c2');
    expect(c2Result?.output).toEqual({
      ok: true,
      summary: expect.any(String),
      userMessage: engineReply,
    });
  });
});

// ============================================================================
// Behavior 6: sidechannel events
// ============================================================================

describe('RealtimeSession — sidechannel events', () => {
  it('emits a matching tool_call -> tool_result pair with a measured latencyMs', async () => {
    const { session, adapter, events } = makeHarness();
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'get_ui_state',
      argumentsJson: '{}',
    });
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

    adapter.emitToolCall({
      callId: 'c1',
      name: 'get_ui_state',
      argumentsJson: '{}',
    });
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

  it('resolves the abandoned queued-intent promise to false on teardown instead of leaving it hanging forever', async () => {
    const { session, adapter, events } = makeHarness();
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
    await flushMicrotasks(); // c2 is now queued: #queuedIntent set, its resolve() pending forever without the fix

    await session.disconnect();
    await flushMicrotasks();

    // #handleToolCall awaits #handleUpdateUI's returned promise to compute
    // `ok` for this event — if teardown left #queuedIntent's resolve
    // uncalled, that promise dangles forever and this event never fires.
    const c2ToolResult = events.find(
      (e) => e.type === 'tool_result' && e.callId === 'c2',
    );
    expect(c2ToolResult).toBeDefined();
    if (c2ToolResult?.type === 'tool_result') {
      expect(c2ToolResult.ok).toBe(false);
    }

    // No sendToolResult for the abandoned call either way — teardown drops
    // it silently rather than answering it (the adapter is gone too).
    expect(adapter.toolResults.find((r) => r.callId === 'c2')).toBeUndefined();
  });

  it('disconnecting while connect() is still in flight lands idle instead of resurrecting the session once the handshake resolves', async () => {
    const { session, adapter, instance } = makeHarness();
    const states: string[] = [];
    session.on('state', (s) => states.push(s));
    const release = adapter.gateConnect();

    const connectPromise = session.connect();
    await flushMicrotasks();
    expect(session.state).toBe('connecting');

    // The last consumer unmounts mid-handshake (e.g. a token-mint round
    // trip) and calls disconnect() before adapter.connect() has resolved.
    const disconnectPromise = session.disconnect();
    await flushMicrotasks();
    expect(session.state).toBe('idle');
    expect(adapter.disconnectCalls).toBe(1);

    // Now the gated handshake resolves — without the epoch guard this would
    // subscribe onSettled and flip the state back to 'connected'.
    release();
    await connectPromise;
    await disconnectPromise;

    expect(session.state).toBe('idle');
    expect(states).not.toContain('connected');
    // The stale connect() attempt must tear itself back down rather than
    // leaving a second live adapter subscription, a hot connection, or a
    // dangling onSettled subscription behind.
    expect(adapter.listenerCount).toBe(0);
    expect(adapter.disconnectCalls).toBe(2);
    expect(instance.settledSubscriberCount).toBe(0);
  });
});

// ============================================================================
// Behavior 8: error surfacing
// ============================================================================

describe('RealtimeSession — error surfacing', () => {
  it('transitions to error and records lastError on a fatal adapter error', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();

    const fatal = new RealtimeVoiceError(
      'CONNECTION_FAILED',
      'ICE connection failed',
    );
    adapter.emitError(fatal);

    expect(session.state).toBe('error');
    expect(session.lastError).toBe(fatal);
  });

  it('stays connected on a non-fatal adapter error', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();

    adapter.emitError(new Error('malformed frame'));

    expect(session.state).toBe('connected');
    expect(session.lastError).toBeUndefined();
  });

  it('records lastError when connect() itself rejects', async () => {
    const { session, adapter } = makeHarness();
    adapter.failNextConnect();

    await expect(session.connect()).rejects.toThrow();
    expect(session.state).toBe('error');
    expect(session.lastError).toBeDefined();
  });

  it('disconnect clears lastError, keeping "populated when state is error" truthful', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();

    const fatal = new RealtimeVoiceError(
      'CONNECTION_FAILED',
      'ICE connection failed',
    );
    adapter.emitError(fatal);
    expect(session.state).toBe('error');
    expect(session.lastError).toBe(fatal);

    await session.disconnect();

    expect(session.state).toBe('idle');
    expect(session.lastError).toBeUndefined();
  });

  it('a fatal error during a gated handshake lands in error and never transitions to connected', async () => {
    // A fatal RealtimeVoiceError arriving while adapter.connect() is still in
    // flight must win: when the gated handshake finally resolves, the epoch
    // it was started under is stale, so connect() tears the now-live adapter
    // back down instead of resurrecting the fatally-errored session.
    const { session, adapter } = makeHarness();
    const states: string[] = [];
    session.on('state', (s) => states.push(s));

    const release = adapter.gateConnect();
    const connectPromise = session.connect();
    await flushMicrotasks();
    expect(session.state).toBe('connecting');

    const fatal = new RealtimeVoiceError(
      'CONNECTION_FAILED',
      'ICE connection failed',
    );
    adapter.emitError(fatal);
    expect(session.state).toBe('error');
    expect(session.lastError).toBe(fatal);

    // The gated handshake resolves only now — without the epoch bump in the
    // fatal-error branch this would flip the session back to 'connected'.
    release();
    await connectPromise;
    await flushMicrotasks();

    expect(session.state).toBe('error');
    expect(session.lastError).toBe(fatal);
    expect(states).not.toContain('connected');
  });

  it('cleans up the dead subscription on a fatal adapter error so a reconnect does not stack a second one', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    expect(adapter.listenerCount).toBe(1);

    const fatal = new RealtimeVoiceError(
      'CONNECTION_FAILED',
      'ICE connection failed',
    );
    adapter.emitError(fatal);
    expect(session.state).toBe('error');

    await session.connect(); // retry after the fatal error
    expect(session.state).toBe('connected');
    expect(adapter.listenerCount).toBe(1); // not 2 — the dead subscription was torn down

    adapter.emitToolCall({
      callId: 'c1',
      name: 'get_ui_state',
      argumentsJson: '{}',
    });
    await flushMicrotasks();

    // Exactly one tool_result — a leaked handler from the errored session
    // would have produced two.
    expect(adapter.toolResults).toHaveLength(1);
  });
});

// ============================================================================
// Behavior 9: transcript subscription
// ============================================================================

describe('RealtimeSession — transcript subscription', () => {
  it('forwards adapter transcripts to on(transcript) subscribers', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    const seen: Array<{ role: string; text: string; final: boolean }> = [];
    session.on('transcript', (t) => seen.push(t));

    adapter.emitTranscript({
      role: 'assistant',
      text: 'On it — ',
      final: false,
    });
    adapter.emitTranscript({
      role: 'assistant',
      text: 'On it — done.',
      final: true,
    });

    expect(seen).toEqual([
      { role: 'assistant', text: 'On it — ', final: false },
      { role: 'assistant', text: 'On it — done.', final: true },
    ]);
  });

  it('unsubscribe stops delivery', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    const seen: unknown[] = [];
    const off = session.on('transcript', (t) => seen.push(t));
    off();
    adapter.emitTranscript({ role: 'user', text: 'hello', final: true });
    expect(seen).toEqual([]);
  });

  it('mirrors transcripts onto the sidechannel with session id and timestamp', async () => {
    const { session, adapter, events } = makeHarness();
    await session.connect();

    adapter.emitTranscript({ role: 'user', text: 'show my day', final: true });

    const transcriptEvents = events.filter((e) => e.type === 'transcript');
    expect(transcriptEvents).toHaveLength(1);
    expect(transcriptEvents[0]).toMatchObject({
      type: 'transcript',
      sessionId: testSessionId,
      role: 'user',
      text: 'show my day',
      final: true,
    });
    expect((transcriptEvents[0] as { at: number }).at).toBeGreaterThan(0);
  });
});

// ============================================================================
// Behavior 10: audio streams delegation
// ============================================================================

describe('RealtimeSession — audio streams', () => {
  it('delegates getAudioStreams to the adapter', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    expect(session.getAudioStreams()).toBe(adapter.lastAudioStreams);
  });
});

describe('RealtimeSession — turn mode', () => {
  it('defaults speech-native adapters to automatic mode without manual controls', () => {
    const { session, adapter } = makeHarness();
    adapter.setTurnControl({
      startTurn: async () => {},
      endTurn: async () => {},
    });

    expect(session.turnMode).toBe('automatic');
    expect(session.turnModeError).toBeUndefined();
    expect(session.turnControl).toBeUndefined();
  });

  it('retains manual degradation, notifies subscribers, and delegates the current manual control', async () => {
    const { session, adapter } = makeHarness();
    const firstControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const replacementControl = {
      startTurn: async () => {},
      endTurn: async () => {},
    };
    const cause = new Error('VAD unavailable');
    const seen: TurnModeEvent[] = [];
    session.on('turn_mode', (event) => seen.push(event));
    adapter.setTurnControl(firstControl);
    await session.connect();
    seen.length = 0;

    adapter.emitTurnMode('manual', cause);

    expect(session.turnMode).toBe('manual');
    expect(session.turnModeError).toBe(cause);
    expect(session.turnControl).toBe(firstControl);
    expect(seen).toEqual([{ type: 'turn_mode', mode: 'manual', error: cause }]);

    adapter.setTurnControl(replacementControl);
    expect(session.turnControl).toBe(replacementControl);
  });

  it('clears a prior diagnostic when the adapter establishes a clean mode', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    adapter.emitTurnMode('manual', new Error('VAD unavailable'));

    adapter.emitTurnMode('manual');
    expect(session.turnMode).toBe('manual');
    expect(session.turnModeError).toBeUndefined();

    adapter.emitTurnMode('automatic');
    expect(session.turnMode).toBe('automatic');
    expect(session.turnModeError).toBeUndefined();
    expect(session.turnControl).toBeUndefined();
  });

  it('clears stale turn-mode state after a successful reconnect', async () => {
    const { session, adapter } = makeHarness();
    const seen: TurnModeEvent[] = [];
    session.on('turn_mode', (event) => seen.push(event));
    await session.connect();
    adapter.emitTurnMode('manual', new Error('VAD unavailable'));
    await session.disconnect();

    await session.connect();

    expect(session.turnMode).toBe('automatic');
    expect(session.turnModeError).toBeUndefined();
    expect(seen.at(-1)).toEqual({ type: 'turn_mode', mode: 'automatic' });
  });

  it('does not mirror turn-mode events onto the sidechannel', async () => {
    const { session, adapter, events } = makeHarness();
    await session.connect();

    adapter.emitTurnMode('manual', new Error('VAD unavailable'));

    expect(events).toEqual([]);
  });

  it('stops turn-mode delivery after unsubscribe', async () => {
    const { session, adapter } = makeHarness();
    const seen: TurnModeEvent[] = [];
    const off = session.on('turn_mode', (event) => seen.push(event));
    await session.connect();
    off();
    seen.length = 0;

    adapter.emitTurnMode('manual');

    expect(seen).toEqual([]);
  });

  it('delivers each update to every turn-mode subscriber', async () => {
    const { session, adapter } = makeHarness();
    const first: TurnModeEvent[] = [];
    const second: TurnModeEvent[] = [];
    session.on('turn_mode', (event) => first.push(event));
    session.on('turn_mode', (event) => second.push(event));
    await session.connect();
    first.length = 0;
    second.length = 0;

    adapter.emitTurnMode('manual');

    const update: TurnModeEvent = { type: 'turn_mode', mode: 'manual' };
    expect(first).toEqual([update]);
    expect(second).toEqual([update]);
  });

  it('preserves degraded manual mode when a reconnect fails', async () => {
    const { session, adapter } = makeHarness();
    const cause = new Error('VAD unavailable');
    const seen: TurnModeEvent[] = [];
    session.on('turn_mode', (event) => seen.push(event));
    await session.connect();
    adapter.emitTurnMode('manual', cause);
    await session.disconnect();
    seen.length = 0;
    adapter.failNextConnect();

    await expect(session.connect()).rejects.toThrow('adapter connect failed');

    expect(seen).toEqual([]);
    expect(session.turnMode).toBe('manual');
    expect(session.turnModeError).toBe(cause);
  });

  it('establishes speech-native automatic mode only after connect succeeds', async () => {
    const { session, adapter } = makeHarness();
    const seen: TurnModeEvent[] = [];
    session.on('turn_mode', (event) => seen.push(event));
    const release = adapter.gateConnect();

    const connectPromise = session.connect();
    await flushMicrotasks();
    expect(seen).toEqual([]);

    release();
    await connectPromise;

    expect(seen).toEqual([{ type: 'turn_mode', mode: 'automatic' }]);
    expect(session.turnMode).toBe('automatic');
    expect(session.turnModeError).toBeUndefined();
  });

  it('exposes manual turn control before notifying turn-mode subscribers', async () => {
    const { session, adapter } = makeHarness();
    const control = { startTurn: async () => {}, endTurn: async () => {} };
    const observed: Array<AdapterTurnControl | undefined> = [];
    session.on('turn_mode', (event) => {
      if (event.mode === 'manual') observed.push(session.turnControl);
    });
    await session.connect();
    adapter.setTurnControl(control);

    adapter.emitTurnMode('manual');

    expect(observed).toEqual([control]);
  });
});

describe('VoiceSession — realtime boundary', () => {
  it('keeps turn mode off the shared client seam', () => {
    const clientSession = null as unknown as VoiceSession;
    // @ts-expect-error turn mode belongs only to RealtimeSession
    void clientSession?.turnMode;
    // @ts-expect-error turn-mode diagnostics belong only to RealtimeSession
    void clientSession?.turnModeError;
    // @ts-expect-error turn-mode subscriptions belong only to RealtimeSession
    void clientSession?.on('turn_mode', () => {});

    expect(true).toBe(true);
  });
});
