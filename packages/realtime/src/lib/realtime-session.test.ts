import { describe, expect, it } from 'bun:test';
import type { UiStructuralSnapshot } from '@maelstrom-co/client';
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
  emitToolCall(call: { callId: string; name: string; argumentsJson: string }): void;
}

function makeMockAdapter(): MockAdapter {
  const toolResults: Array<{ callId: string; output: unknown }> = [];
  const groundingCalls: string[] = [];
  let handler: ((event: RealtimeAdapterEvent) => void) | undefined;
  let connectCalls = 0;

  return {
    toolResults,
    groundingCalls,
    get connectCalls() {
      return connectCalls;
    },
    connect: async () => {
      connectCalls += 1;
    },
    disconnect: async () => {},
    sendToolResult: async (callId, output) => {
      toolResults.push({ callId, output });
    },
    injectGrounding: (text) => {
      groundingCalls.push(text);
    },
    on: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
    emitToolCall(call) {
      handler?.({ type: 'tool_call', ...call });
    },
  };
}

// ============================================================================
// Mock instance
// ============================================================================

interface MockInstance extends RealtimeInstance {
  readonly submitted: string[];
  settle(): void;
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
        throw new Error('A request is already in flight');
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
// Behavior 5: barge-in serialization
// ============================================================================

describe('RealtimeSession — barge-in serialization', () => {
  it('answers a concurrent update_ui gracefully instead of throwing or dropping it', async () => {
    const { session, adapter, instance } = makeHarness();
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

    // Never reached the instance — the in-flight guard fired first.
    expect(instance.submitted).toEqual(['show labs']);
    // Never thrown to the adapter: answered gracefully instead.
    const c2Result = adapter.toolResults.find((r) => r.callId === 'c2');
    expect(c2Result?.output).toEqual({
      ok: false,
      summary: expect.stringContaining('try again'),
    });

    instance.settle();
    await flushMicrotasks();

    const c1Result = adapter.toolResults.find((r) => r.callId === 'c1');
    expect(c1Result?.output).toEqual({ summary: expect.any(String) });
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
