import { describe, expect, it, spyOn } from 'bun:test';
import type {
  CapabilitySnapshot,
  TimedTranscriptFragment,
  UIStructuralSnapshot,
  VoiceSession,
} from '@maelstrom-co/client';
import { RequestInFlightError } from '@maelstrom-co/client';
import type {
  MessageId,
  Result,
  SidechannelEvent,
} from '@maelstrom-co/protocol';
import {
  ActionName,
  err,
  InstanceId,
  ok,
  SessionId,
  ToolCallId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { GreetingCoordinator } from '../greeting-coordinator.js';
import { RealtimeVoiceError } from '../realtime-voice-error.js';
import type {
  AdapterAudioStreams,
  AdapterConnectOptions,
  AdapterTurnControl,
  AdapterVoiceObservation,
  GreetingSpeechResult,
  RealtimeAdapterEvent,
  RealtimeGreetingAdapter,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
  TurnModeEvent,
  UpdateUIToolResult,
} from './provider-adapter.types.js';
import { RealtimeSession } from './realtime-session.js';
import type {
  GreetingState,
  RealtimeInstance,
  SubmitIntentResult,
} from './realtime-session.types.js';
import { RealtimeSessionMemory } from './realtime-session-memory.js';
import { VoiceObservationStore } from './voice-observation-store.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('additive continuous capabilities', () => {
  it('preserves deliberate cancellation during recovery without installing a late listener', async () => {
    const { session, adapter } = makeHarness();
    const subscribe = spyOn(session.memory, 'subscribe');
    let ending: Promise<void> | undefined;
    Object.assign(adapter, {
      recovery: {
        update: () => {
          ending = session.disconnect();
        },
      },
    });
    await session.connect();
    await ending;
    expect(session.state).toBe('idle');
    expect(subscribe).not.toHaveBeenCalled();
    subscribe.mockRestore();
  });
  it('rejects synchronous fatal recovery setup without retaining listeners on repeated attempts', async () => {
    const { session, adapter, instance } = makeHarness();
    const failure = new RealtimeVoiceError(
      'DATA_CHANNEL_ERROR',
      'recovery failed',
    );
    const subscribe = spyOn(session.memory, 'subscribe');
    Object.assign(adapter, {
      recovery: { update: () => adapter.emitError(failure) },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(session.connect()).rejects.toBe(failure);
      expect(session.lastError).toBe(failure);
      expect(session.state).toBe('error');
      expect(adapter.listenerCount).toBe(0);
      expect(instance.settledSubscriberCount).toBe(0);
      expect(subscribe).not.toHaveBeenCalled();
    }
    subscribe.mockRestore();
    await session.disconnect();
  });

  it('preserves provider and disposer failures together after shutdown', async () => {
    const { session, adapter } = makeHarness();
    const cleanup = new Error('observation release failed');
    const provider = new Error('provider disconnect failed');
    Object.assign(adapter, {
      observations: {
        subscribe: () => () => {
          throw cleanup;
        },
      },
    });
    await session.connect();
    adapter.failNextDisconnect(provider);
    const error = await session.disconnect().catch((error: unknown) => error);
    expect((error as AggregateError).errors).toEqual([cleanup, provider]);
    expect(session.state).toBe('idle');
    expect(adapter.listenerCount).toBe(0);
  });

  it('finishes failed startup cleanup without replacing the original connection failure', async () => {
    const { session, adapter } = makeHarness();
    const cleanup = new Error('observation release failed');
    Object.assign(adapter, {
      observations: {
        subscribe: () => () => {
          throw cleanup;
        },
      },
    });
    adapter.failNextConnect();
    const error = await session.connect().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors[0].message).toBe(
      'adapter connect failed',
    );
    expect((error as AggregateError).errors[1]).toBe(cleanup);
    expect(session.lastError).toBe(error);
    expect(session.state).toBe('error');
    expect(session.observations.getSnapshot().connection).toBe('error');
    expect(adapter.listenerCount).toBe(0);
    await session.disconnect();
  });

  it('releases a disposer returned after a reentrant disconnect and reports its failure through connect', async () => {
    const { session, adapter } = makeHarness();
    const cleanup = new Error('late observation release failed');
    let disconnect: Promise<void> | undefined;
    Object.assign(adapter, {
      observations: {
        subscribe: () => {
          disconnect = session.disconnect();
          return () => {
            throw cleanup;
          };
        },
      },
    });
    await expect(session.connect()).rejects.toBe(cleanup);
    await disconnect;
    expect(adapter.connectCalls).toBe(0);
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.listenerCount).toBe(0);
    expect(session.state).toBe('idle');
  });

  it('retains fatal provider and cleanup failures without throwing out of the event callback', async () => {
    const { session, adapter, instance } = makeHarness();
    const cleanup = new Error('observation release failed');
    const provider = new RealtimeVoiceError(
      'DATA_CHANNEL_ERROR',
      'connection lost',
    );
    Object.assign(adapter, {
      observations: {
        subscribe: () => () => {
          throw cleanup;
        },
      },
    });
    await session.connect();
    expect(() => adapter.emitError(provider)).not.toThrow();
    expect((session.lastError as AggregateError).errors).toEqual([
      provider,
      cleanup,
    ]);
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.listenerCount).toBe(0);
    expect(instance.settledSubscriberCount).toBe(0);
    expect(session.state).toBe('error');
    await session.disconnect();
  });

  it('attempts every disposer and closes the provider before reporting cleanup failures', async () => {
    const { session, adapter, instance } = makeHarness();
    const failures = [
      new Error('observations'),
      new Error('legacy'),
      new Error('settled'),
    ];
    const released: string[] = [];
    const on = adapter.on;
    adapter.on = (handler) => {
      const release = on(handler);
      return () => {
        release();
        released.push('legacy');
        throw failures[1];
      };
    };
    const onSettled = instance.onSettled;
    instance.onSettled = (handler) => {
      const release = onSettled(handler);
      return () => {
        release();
        released.push('settled');
        throw failures[2];
      };
    };
    Object.assign(adapter, {
      observations: {
        subscribe: () => () => {
          released.push('observations');
          throw failures[0];
        },
      },
    });
    await session.connect();
    const releaseGate = adapter.gateDisconnect();
    const disconnect = session.disconnect();
    const result = disconnect.catch((error: unknown) => error);
    expect(session.disconnect()).toBe(disconnect);
    releaseGate();
    const error = await result;
    expect(released).toEqual(['observations', 'legacy', 'settled']);
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.listenerCount).toBe(0);
    expect(instance.settledSubscriberCount).toBe(0);
    expect(session.state).toBe('idle');
    expect(session.observations.getSnapshot().connection).toBe('disconnected');
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual(failures);
    await session.disconnect();
    expect(released).toHaveLength(3);
  });

  it('keeps replacement subscriptions and transport alive when an older handshake succeeds late', async () => {
    const { session, adapter, instance } = makeHarness();
    const observers = new Set<(event: AdapterVoiceObservation) => void>();
    Object.assign(adapter, {
      observations: {
        subscribe: (handler: (event: AdapterVoiceObservation) => void) => {
          observers.add(handler);
          return () => {
            observers.delete(handler);
          };
        },
      },
    });
    const releaseA = adapter.gateConnect();
    const a = session.connect();
    await session.disconnect();
    const releaseB = adapter.gateConnect();
    const b = session.connect();
    releaseB();
    await b;
    expect(observers.size).toBe(1);
    releaseA();
    await a;
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.listenerCount).toBe(1);
    expect(instance.settledSubscriberCount).toBe(1);
    expect(observers.size).toBe(1);
    for (const observer of observers)
      observer({ type: 'media', media: { microphone: 'active' } });
    expect(session.observations.getSnapshot()).toMatchObject({
      connection: 'connected',
      generation: 2,
      media: { microphone: 'active' },
    });
    await session.disconnect();
    expect(observers.size).toBe(0);
  });

  it('tears down a late successful handshake when no replacement has started', async () => {
    const { session, adapter } = makeHarness();
    const release = adapter.gateConnect();
    const connecting = session.connect();
    await session.disconnect();
    release();
    await connecting;
    expect(adapter.disconnectCalls).toBe(2);
    expect(adapter.listenerCount).toBe(0);
    expect(session.observations.getSnapshot().connection).toBe('disconnected');
  });

  it('isolates throwing observers while preserving shutdown, other observers, and provider rejection', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    const failure = new Error('provider teardown failed');
    adapter.failNextDisconnect(failure);
    const releaseGate = adapter.gateDisconnect();
    const releaseThrowing = session.observations.subscribe(() => {
      throw new Error('observer failed');
    });
    const seen: string[] = [];
    const releaseHealthy = session.observations.subscribe(() =>
      seen.push(session.observations.getSnapshot().connection),
    );
    const legacy: string[] = [];
    session.on('state', (state) => legacy.push(state));
    const disconnect = session.disconnect();
    expect(session.disconnect()).toBe(disconnect);
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.listenerCount).toBe(0);
    expect(seen).toEqual(['disconnecting']);
    releaseGate();
    await expect(disconnect).rejects.toBe(failure);
    expect(seen).toEqual(['disconnecting', 'disconnected']);
    expect(legacy).toEqual(['idle']);
    releaseThrowing();
    releaseHealthy();
    await session.connect();
    expect(session.state).toBe('connected');
    await session.disconnect();
  });

  it('does not emit legacy connected after an observer begins a pending disconnect', async () => {
    const { session, adapter } = makeHarness();
    const releaseGate = adapter.gateDisconnect();
    let disconnect: Promise<void> | undefined;
    const seen: string[] = [];
    session.on('state', (state) => seen.push(`legacy:${state}`));
    const release = session.observations.subscribe(() => {
      const connection = session.observations.getSnapshot().connection;
      seen.push(`observation:${connection}`);
      if (connection === 'connected') disconnect = session.disconnect();
    });
    await session.connect();
    expect(seen).toEqual([
      'legacy:connecting',
      'observation:connecting',
      'observation:connected',
      'observation:disconnecting',
    ]);
    releaseGate();
    await disconnect;
    expect(seen.slice(-2)).toEqual(['observation:disconnected', 'legacy:idle']);
    release();
  });

  it('rejects invalid transcript bounds synchronously during session construction', () => {
    const { adapter, instance } = makeHarness();
    for (const transcript of [
      { maxFragments: Number.MAX_SAFE_INTEGER + 1 },
      { maxFragmentChars: 1.5 },
      { maxFragments: 0 },
      { groupGapMs: Infinity },
      { groupGapMs: -1 },
    ]) {
      expect(
        () =>
          new RealtimeSession({
            adapter,
            instance,
            sessionId: testSessionId,
            transcript,
          }),
      ).toThrow(RangeError);
    }
    expect(adapter.connectCalls).toBe(0);
  });

  it('lets an observation subscriber stop startup before provider work starts', async () => {
    const { session, adapter } = makeHarness();
    let disconnect: Promise<void> | undefined;
    const release = session.observations.subscribe(() => {
      if (session.observations.getSnapshot().connection === 'connecting') {
        disconnect = session.disconnect();
      }
    });
    await session.connect();
    await disconnect;
    expect(adapter.connectCalls).toBe(0);
    expect(session.observations.getSnapshot().connection).toBe('disconnected');
    release();
  });

  it('releases continuous subscriptions on fatal provider loss and rejects their late evidence', async () => {
    const adapter = makeMockAdapter();
    let callback: ((event: AdapterVoiceObservation) => void) | undefined;
    let released = 0;
    Object.assign(adapter, {
      observations: {
        subscribe: (handler: (event: AdapterVoiceObservation) => void) => {
          callback = handler;
          return () => {
            released += 1;
          };
        },
      },
    });
    const session = new RealtimeSession({
      adapter,
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
    });
    await session.connect();
    callback?.({ type: 'media', media: { microphone: 'active' } });
    adapter.emitError(
      new RealtimeVoiceError('DATA_CHANNEL_ERROR', 'connection lost'),
    );
    const failed = session.observations.getSnapshot();
    expect(failed).toMatchObject({
      connection: 'error',
      media: { microphone: 'unknown' },
    });
    expect(released).toBe(1);
    callback?.({ type: 'media', media: { microphone: 'active' } });
    expect(session.observations.getSnapshot()).toBe(failed);
    await session.disconnect();
  });

  it('fences old subscriptions and never converts fragments or speaking state into legacy turns or audible evidence', async () => {
    const adapter = makeMockAdapter();
    const callbacks: Array<(event: AdapterVoiceObservation) => void> = [];
    let releases = 0;
    Object.assign(adapter, {
      observations: {
        subscribe: (callback: (event: AdapterVoiceObservation) => void) => {
          callbacks.push(callback);
          return () => {
            releases += 1;
          };
        },
      },
    });
    const session = new RealtimeSession({
      adapter,
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
    });
    const legacy: unknown[] = [];
    session.on('transcript', (entry) => legacy.push(entry));
    await session.connect();
    const event: AdapterVoiceObservation = {
      type: 'fragment',
      fragment: {
        id: '1',
        role: 'user',
        speakerId: 'user',
        text: '  raw',
        startMs: 0,
        endMs: 20,
      },
    };
    callbacks[0](event);
    expect(session.observations.getSnapshot().captions[0].text).toBe('  raw');
    expect(legacy).toEqual([]);
    expect(session.observations.getSnapshot().media.incomingAudio).toBe(
      'unknown',
    );
    callbacks[0]({ type: 'media', media: { microphone: 'active' } });
    await session.disconnect();
    expect(releases).toBe(1);
    const disconnected = session.observations.getSnapshot();
    callbacks[0]({ type: 'media', media: { microphone: 'active' } });
    expect(session.observations.getSnapshot()).toBe(disconnected);
    await session.connect();
    callbacks[0](event);
    expect(session.observations.getSnapshot().fragments).toEqual([]);
    callbacks[1](event);
    expect(session.observations.getSnapshot().fragments).toHaveLength(1);
    adapter.emitTranscript({ role: 'assistant', text: 'legacy', final: true });
    expect(legacy).toEqual([
      { role: 'assistant', text: 'legacy', final: true },
    ]);
    await session.disconnect();
  });

  it('separates conversation instructions and requests generated wording only once across reconnects without fabricated history', async () => {
    const adapter = makeMockAdapter();
    const requests: string[] = [];
    Object.assign(adapter, {
      generatedOpening: {
        request: async (instructions: string) => {
          requests.push(instructions);
        },
      },
    });
    const instance = makeMockInstance(emptySnapshot);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      conversationInstructions: 'Be brief.',
    });
    const legacy: unknown[] = [];
    session.on('transcript', (entry) => legacy.push(entry));
    expect(
      await session.requestGeneratedOpening('Introduce yourself naturally.'),
    ).toBe(false);
    await session.connect();
    expect(adapter.connectOptions[0].conversationInstructions).toBe(
      'Be brief.',
    );
    expect(adapter.connectOptions[0].instructions).toContain('update_ui');
    expect(adapter.connectOptions[0].tools).toHaveLength(3);
    expect(
      await session.requestGeneratedOpening('Introduce yourself naturally.'),
    ).toBe(true);
    await session.disconnect();
    await session.connect();
    expect(
      await session.requestGeneratedOpening('Introduce yourself naturally.'),
    ).toBe(false);
    expect(requests).toEqual(['Introduce yourself naturally.']);
    expect(legacy).toEqual([]);
    expect(session.observations.getSnapshot().fragments).toEqual([]);
    expect(instance.acknowledged).toEqual([]);
    await session.disconnect();
  });

  it('does not retry an ambiguous opening failure or treat a generated-opening adapter as a fixed-greeting adapter', async () => {
    const adapter = makeMockAdapter();
    let attempts = 0;
    Object.assign(adapter, {
      generatedOpening: {
        request: async () => {
          attempts += 1;
          throw new Error('ambiguous send');
        },
      },
    });
    const session = new RealtimeSession({
      adapter,
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
    });
    await session.connect();
    await expect(session.requestGeneratedOpening('Hello')).rejects.toThrow(
      'ambiguous send',
    );
    expect(await session.requestGeneratedOpening('Hello')).toBe(false);
    expect(attempts).toBe(1);
    await session.disconnect();
    const fixed = new RealtimeSession({
      adapter,
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
      greeting: { text: 'Exact.', coordinator: new GreetingCoordinator() },
    });
    await expect(fixed.connect()).rejects.toThrow('RealtimeGreetingAdapter');
    expect(await fixed.requestGeneratedOpening('Hello')).toBe(false);
  });
});

// ============================================================================
// Mock adapter
// ============================================================================

interface MockAdapter extends RealtimeProviderAdapter {
  readonly toolResults: Array<{ callId: string; output: unknown }>;
  readonly groundingCalls: string[];
  readonly connectCalls: number;
  readonly connectOptions: readonly AdapterConnectOptions[];
  readonly disconnectCalls: number;
  /** Tools passed to the most recent `connect()` call. */
  readonly lastConnectTools: readonly RealtimeToolSpec[] | undefined;
  /** Number of adapter-event handlers currently subscribed via `on()` — a leaked subscription shows up here. */
  readonly listenerCount: number;
  /** Makes the next `connect()` call reject instead of resolving. */
  failNextConnect(): void;
  /** Makes the next `disconnect()` call invoke a hook, then reject with the supplied value. */
  failNextDisconnect(error: unknown, beforeReject?: () => void): void;
  /** Makes `connect()` block until the returned function is called. */
  gateConnect(): () => void;
  /** Makes `disconnect()` block until the returned function is called. */
  gateDisconnect(): () => void;
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
  const connectOptions: AdapterConnectOptions[] = [];
  let connectCalls = 0;
  let disconnectCalls = 0;
  let lastConnectTools: readonly RealtimeToolSpec[] | undefined;
  let shouldFailNextConnect = false;
  let nextDisconnectFailure:
    | { error: unknown; beforeReject?: () => void }
    | undefined;
  let gate: Promise<void> | undefined;
  let disconnectGate: Promise<void> | undefined;
  let turnControl: AdapterTurnControl | undefined;
  const lastAudioStreams: AdapterAudioStreams = {};

  return {
    observations: { subscribe: () => () => {} },
    toolResults,
    groundingCalls,
    connectOptions,
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
    failNextDisconnect(error, beforeReject) {
      nextDisconnectFailure = { error, beforeReject };
    },
    gateConnect() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    gateDisconnect() {
      let release!: () => void;
      disconnectGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    connect: async (opts) => {
      connectCalls += 1;
      connectOptions.push(opts);
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
      if (disconnectGate) {
        await disconnectGate;
        disconnectGate = undefined;
      }
      if (nextDisconnectFailure) {
        const failure = nextDisconnectFailure;
        nextDisconnectFailure = undefined;
        failure.beforeReject?.();
        throw failure.error;
      }
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
  readonly acknowledged: Array<{ id: MessageId; message: string }>;
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
  /** Number of engine-connection observers currently registered. */
  readonly engineConnectionSubscriberCount: number;
  /** Emit a connected/disconnected transition to engine observers. */
  emitEngineConnected(connected?: boolean): void;
  /** Override the next ack outcome (or throw). */
  setAckResult(
    result:
      | 'inserted'
      | 'deduped'
      | Error
      | (() => Promise<'inserted' | 'deduped'>),
  ): void;
  /** Hold the next ack until the returned release function is called. */
  gateAck(): () => void;
}

function makeMockInstance(
  snapshot: UIStructuralSnapshot,
  capabilitySnapshot: CapabilitySnapshot = emptyCapabilitySnapshot,
  submitResult: SubmitIntentResult = {},
): MockInstance {
  const submitted: string[] = [];
  const acknowledged: Array<{ id: MessageId; message: string }> = [];
  const settledHandlers = new Set<() => void>();
  const engineHandlers = new Set<(connected: boolean) => void>();
  let pendingResolvers: Array<() => void> = [];
  let inFlight = false;
  let engineConnected = true;
  let ackResult:
    | 'inserted'
    | 'deduped'
    | Error
    | (() => Promise<'inserted' | 'deduped'>) = 'inserted';
  let ackGate: Promise<void> | undefined;

  return {
    submitted,
    acknowledged,
    get settledSubscriberCount() {
      return settledHandlers.size;
    },
    get engineConnectionSubscriberCount() {
      return engineHandlers.size;
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
    addAssistantMessageAcknowledged: async (args) => {
      acknowledged.push(args);
      if (ackGate) {
        await ackGate;
        ackGate = undefined;
      }
      if (typeof ackResult === 'function') return ackResult();
      if (ackResult instanceof Error) throw ackResult;
      return ackResult;
    },
    observeEngineConnection: (cb) => {
      engineHandlers.add(cb);
      cb(engineConnected);
      return () => {
        engineHandlers.delete(cb);
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
    emitEngineConnected(connected = true) {
      engineConnected = connected;
      for (const cb of engineHandlers) cb(connected);
    },
    setAckResult(result) {
      ackResult = result;
    },
    gateAck() {
      let release!: () => void;
      ackGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

const inertInstanceMembers = {
  addAssistantMessageAcknowledged: async () => 'inserted' as const,
  observeEngineConnection: () => () => {},
};

interface MockGreetingAdapter extends MockAdapter, RealtimeGreetingAdapter {
  readonly activateAudioCalls: number;
  readonly speakCalls: Array<{
    id: MessageId;
    text: string;
    signal: AbortSignal;
    onPlaybackStart?: () => void;
  }>;
  setSpeakResult(
    result: GreetingSpeechResult | (() => Promise<GreetingSpeechResult>),
  ): void;
}

function makeGreetingAdapter(): MockGreetingAdapter {
  // Do not object-spread the mock: getters like connectCalls would collapse
  // to a stale data property. Attach greeting fields onto the live mock.
  const base = makeMockAdapter();
  const speakCalls: Array<{
    id: MessageId;
    text: string;
    signal: AbortSignal;
    onPlaybackStart?: () => void;
  }> = [];
  let activateAudioCalls = 0;
  let speakResult:
    | GreetingSpeechResult
    | (() => Promise<GreetingSpeechResult>) = 'accepted';

  const greeting = base as MockGreetingAdapter;
  Object.defineProperty(greeting, 'activateAudioCalls', {
    get: () => activateAudioCalls,
    enumerable: true,
  });
  Object.defineProperty(greeting, 'speakCalls', {
    get: () => speakCalls,
    enumerable: true,
  });
  greeting.activateAudio = () => {
    activateAudioCalls += 1;
  };
  greeting.speakAssistantText = async (args) => {
    speakCalls.push(args);
    const result =
      typeof speakResult === 'function' ? await speakResult() : speakResult;
    if (result === 'accepted') args.onPlaybackStart?.();
    return result;
  };
  greeting.setSpeakResult = (result) => {
    speakResult = result;
  };
  return greeting;
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
  layout: {
    type: 'grid',
    positions: [
      {
        instanceId: InstanceId('inst-1'),
        position: { row: 0, column: 0 },
        size: { width: 1, height: 1 },
      },
    ],
  },
  layoutMode: 'grid',
  chartDimensions: { rows: 8, columns: 12 },
};

const visibleWeatherSnapshot: UIStructuralSnapshot = {
  instances: [
    {
      instanceId: InstanceId('weather-1'),
      vesselId: VesselId('weather'),
      variant: VariantName('weekly'),
    },
  ],
  layout: {
    type: 'tiling',
    tree: ['ID:weather-1'],
    instances: [
      {
        instanceId: InstanceId('weather-1'),
        vesselId: VesselId('weather'),
        variant: VariantName('weekly'),
      },
    ],
  },
  layoutMode: 'tiling',
  chartDimensions: { rows: 8, columns: 12 },
};

const visibleCalendarSnapshot: UIStructuralSnapshot = {
  instances: [
    {
      instanceId: InstanceId('calendar-1'),
      vesselId: VesselId('calendar'),
      variant: VariantName('month'),
    },
  ],
  layout: {
    type: 'tiling',
    tree: ['ID:calendar-1'],
    instances: [
      {
        instanceId: InstanceId('calendar-1'),
        vesselId: VesselId('calendar'),
        variant: VariantName('month'),
      },
    ],
  },
  layoutMode: 'tiling',
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
  it('rejects malformed arguments without logging their contents', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const adapter = makeMockAdapter();
      const session = new RealtimeSession({
        adapter,
        instance: makeMockInstance(emptySnapshot),
        sessionId: testSessionId,
      });
      await session.connect();
      const sensitiveArguments = '{"intent":"private unfinished request';

      adapter.emitToolCall({
        callId: 'malformed-call',
        name: 'update_ui',
        argumentsJson: sensitiveArguments,
      });
      await flushMicrotasks();

      expect(adapter.toolResults).toContainEqual({
        callId: 'malformed-call',
        output: {
          ok: false,
          summary: 'Could not understand that request.',
        },
      });
      expect(
        warnSpy.mock.calls
          .flat()
          .some((argument) => String(argument).includes(sensitiveArguments)),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

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

    liveSnapshot = visibleWeatherSnapshot;
    instance.settle();
    await flushMicrotasks();

    const output = adapter.toolResults[0].output as UpdateUIToolResult;
    expect(output.ok).toBe(true);
    expect(output.summary).toContain('1 vessel');
    expect(output.summary).toContain('weather');
    expect(output.summary).toContain('weekly');
    expect(output.summary).not.toContain('calendar');
    expect(output.summary).not.toContain('tasks');
    const instanceId = visibleWeatherSnapshot.instances[0]!.instanceId;
    expect(output.summary).not.toContain(instanceId);
    expect(adapter.connectOptions[0]!.getInitialGrounding!()).toContain(
      instanceId,
    );
  });
});

// ============================================================================
// Behavior 1b: a refused settle is answered as a failure, not a stale success
// ============================================================================

describe('RealtimeSession — refused settle', () => {
  const refusal = new Error(
    'set_layout rejected: tiling tree names instance "a" more than once',
  );

  function makeRefusingInstance(): {
    readonly instance: RealtimeInstance;
    settle(result: Result<void, Error>): void;
  } {
    let resolvers: Array<(result: Result<void, Error>) => void> = [];
    return {
      instance: {
        submitIntent: async () => ({ userMessage: 'Here are your labs.' }),
        waitForIdle: async () => {},
        waitForIdleResult: () =>
          new Promise<Result<void, Error>>((resolve) => {
            resolvers.push(resolve);
          }),
        // Deliberately non-empty: a stale post-settle snapshot is exactly what
        // the model must not be handed as proof the intent applied.
        getStructuralSnapshot: () => visibleCalendarSnapshot,
        getCapabilitySnapshot: () => emptyCapabilitySnapshot,
        onSettled: () => () => {},
        ...inertInstanceMembers,
      },
      settle(result) {
        const pending = resolvers;
        resolvers = [];
        for (const resolve of pending) resolve(result);
      },
    };
  }

  it('answers ok:false when the settled work reports a refusal', async () => {
    const adapter = makeMockAdapter();
    const events: SidechannelEvent[] = [];
    const { instance, settle } = makeRefusingInstance();
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
    settle(err(refusal));
    await flushMicrotasks();

    expect(adapter.toolResults).toHaveLength(1);
    expect(adapter.toolResults[0]).toEqual({
      callId: 'c1',
      output: {
        ok: false,
        summary: 'Something went wrong applying that change.',
      },
    });
    expect(
      events.some((e) => e.type === 'timing' && e.label === 'update_ui.error'),
    ).toBe(true);
    expect(events.some((e) => e.type === 'tool_result' && e.ok === true)).toBe(
      false,
    );
  });

  it('still answers ok:true when the settled work reports success', async () => {
    const adapter = makeMockAdapter();
    const { instance, settle } = makeRefusingInstance();
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
    });
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();
    settle(ok(undefined));
    await flushMicrotasks();

    expect(adapter.toolResults[0].output).toEqual({
      ok: true,
      summary: expect.any(String),
      userMessage: 'Here are your labs.',
    });
  });

  it('falls back to the void wait for an instance without a result-bearing wait', async () => {
    const { session, adapter, instance } = makeHarness();
    await session.connect();

    adapter.emitToolCall({
      callId: 'c1',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
    await flushMicrotasks();
    instance.settle();
    await flushMicrotasks();

    expect(adapter.toolResults[0].output).toEqual({
      ok: true,
      summary: expect.any(String),
    });
  });

  it('answers a queued barge-in as a failure when its own settle is refused', async () => {
    const adapter = makeMockAdapter();
    const submitted: string[] = [];
    let resolvers: Array<(result: Result<void, Error>) => void> = [];
    let voidResolvers: Array<() => void> = [];
    let inFlight = false;
    const instance: RealtimeInstance = {
      submitIntent: async (intent) => {
        if (inFlight) throw new RequestInFlightError();
        inFlight = true;
        submitted.push(intent);
        return {};
      },
      waitForIdle: () =>
        new Promise<void>((resolve) => {
          voidResolvers.push(resolve);
        }),
      waitForIdleResult: () =>
        new Promise<Result<void, Error>>((resolve) => {
          resolvers.push(resolve);
        }),
      getStructuralSnapshot: () => visibleCalendarSnapshot,
      getCapabilitySnapshot: () => emptyCapabilitySnapshot,
      onSettled: () => () => {},
      ...inertInstanceMembers,
    };
    const settle = (result: Result<void, Error>) => {
      inFlight = false;
      const pendingResults = resolvers;
      const pendingVoids = voidResolvers;
      resolvers = [];
      voidResolvers = [];
      for (const resolve of pendingResults) resolve(result);
      for (const resolve of pendingVoids) resolve();
    };
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
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

    settle(ok(undefined)); // c1 applies; the queued c2 submits next
    await flushMicrotasks();
    expect(submitted).toEqual(['show labs', 'show revenue']);

    settle(err(refusal)); // c2's own render is refused
    await flushMicrotasks();

    expect(adapter.toolResults.find((r) => r.callId === 'c2')?.output).toEqual({
      ok: false,
      summary: 'Something went wrong applying that change.',
    });
  });

  it('does not answer a queued barge-in from a refusal recorded before its own submit', async () => {
    // The pre-submit wait observes the burst that was already running when the
    // barge-in queued, so its failure belongs to the call that queued this one.
    const adapter = makeMockAdapter();
    const submitted: string[] = [];
    let resolvers: Array<(result: Result<void, Error>) => void> = [];
    let voidResolvers: Array<() => void> = [];
    let inFlight = false;
    let settleResult: Result<void, Error> = ok(undefined);
    const instance: RealtimeInstance = {
      submitIntent: async (intent) => {
        if (inFlight) throw new RequestInFlightError();
        inFlight = true;
        submitted.push(intent);
        // Each submit starts a fresh burst, which clears whatever failure the
        // previous one recorded: here the first burst is refused, the second
        // is not.
        settleResult = submitted.length === 1 ? err(refusal) : ok(undefined);
        return {};
      },
      waitForIdle: () =>
        new Promise<void>((resolve) => {
          voidResolvers.push(resolve);
        }),
      waitForIdleResult: () =>
        new Promise<Result<void, Error>>((resolve) => {
          resolvers.push(resolve);
        }),
      getStructuralSnapshot: () => visibleCalendarSnapshot,
      getCapabilitySnapshot: () => emptyCapabilitySnapshot,
      onSettled: () => () => {},
      ...inertInstanceMembers,
    };
    const settle = () => {
      inFlight = false;
      const pendingResults = resolvers;
      const pendingVoids = voidResolvers;
      resolvers = [];
      voidResolvers = [];
      for (const resolve of pendingResults) resolve(settleResult);
      for (const resolve of pendingVoids) resolve();
    };
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
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

    settle(); // c1's burst failed; c2 was queued while it was running
    await flushMicrotasks();
    expect(adapter.toolResults.find((r) => r.callId === 'c1')?.output).toEqual({
      ok: false,
      summary: 'Something went wrong applying that change.',
    });
    expect(submitted).toEqual(['show labs', 'show revenue']);

    settle(); // c2's own render settles cleanly
    await flushMicrotasks();

    expect(adapter.toolResults.find((r) => r.callId === 'c2')?.output).toEqual({
      ok: true,
      summary: expect.any(String),
    });
  });
});

// ============================================================================
// Behavior 2: get_ui_state answers immediately
// ============================================================================

describe('RealtimeSession — get_ui_state', () => {
  it('reads the latest visible-only snapshot immediately, without an intent', async () => {
    let liveSnapshot = visibleCalendarSnapshot;
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
    });
    await session.connect();

    liveSnapshot = visibleWeatherSnapshot;
    adapter.emitToolCall({
      callId: 'c2',
      name: 'get_ui_state',
      argumentsJson: '{}',
    });
    await flushMicrotasks();

    expect(instance.submitted).toEqual([]); // no engine round-trip
    expect(adapter.toolResults).toEqual([
      { callId: 'c2', output: visibleWeatherSnapshot },
    ]);
    const output = adapter.toolResults[0].output as UIStructuralSnapshot;
    expect(output.instances).toEqual(visibleWeatherSnapshot.instances);
    if (output.layout?.type !== 'tiling') {
      throw new Error('expected tiling layout');
    }
    expect(output.layout.instances).toEqual(
      visibleWeatherSnapshot.layout?.type === 'tiling'
        ? visibleWeatherSnapshot.layout.instances
        : [],
    );
    expect(JSON.stringify(output)).not.toContain('calendar');
    expect(JSON.stringify(output)).not.toContain('tasks');
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
  it('distinguishes instance identity and layout revisions while repeated reads keep the same revision', async () => {
    let current: UIStructuralSnapshot = {
      ...emptySnapshot,
      instances: [
        {
          instanceId: InstanceId('journal-a'),
          vesselId: VesselId('journal'),
          variant: VariantName('entry'),
        },
        {
          instanceId: InstanceId('journal-b'),
          vesselId: VesselId('journal'),
          variant: VariantName('entry'),
        },
      ],
    };
    const adapter = makeMockAdapter();
    const instance = makeMockInstance(current);
    const session = new RealtimeSession({
      adapter,
      instance: { ...instance, getStructuralSnapshot: () => current },
      sessionId: testSessionId,
      groundingDebounceMs: 0,
    });
    await session.connect();
    const read = adapter.connectOptions[0]!.getInitialGrounding!;
    const first = read();
    expect(first).toContain('UI snapshot r1');
    expect(first).toContain('journal-a: journal (entry)');
    expect(first).toContain('journal-b: journal (entry)');
    expect(read()).toBe(first);
    current = { ...current, chartDimensions: { columns: 20, rows: 10 } };
    instance.settle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.groundingCalls[0]).toContain('UI snapshot r2');
    expect(read()).toBe(adapter.groundingCalls[0]);
    await session.disconnect();
  });

  it('keeps tool semantics in both prompts but gives the backend a separate non-speaking role', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    const options = adapter.connectOptions[0]!;
    expect(options.instructions).toContain('You are the voice interface');
    expect(options.backendInstructions).toContain(
      'You are the managed UI tool backend',
    );
    expect(options.backendInstructions).not.toContain(
      'You are the voice interface',
    );
    for (const prompt of [options.instructions, options.backendInstructions!]) {
      expect(prompt).toContain('complete natural-language intent');
      expect(prompt).toContain('get_capabilities');
      expect(prompt).toContain('Unknown outcomes do not authorize retrying');
      expect(prompt).toContain('highest snapshot revision');
    }
    await session.disconnect();
  });

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

    liveSnapshot = emptySnapshot;
    instance.settle();
    liveSnapshot = visibleCalendarSnapshot;
    instance.settle();
    liveSnapshot = visibleWeatherSnapshot;
    instance.settle();

    expect(adapter.groundingCalls).toEqual([]); // debounced, nothing yet

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(adapter.groundingCalls).toHaveLength(1);
    expect(adapter.groundingCalls[0]).toContain('1 vessel');
    expect(adapter.groundingCalls[0]).toContain('weather');
    expect(adapter.groundingCalls[0]).toContain('weekly');
    expect(adapter.groundingCalls[0]).toContain('tiling');
    expect(adapter.groundingCalls[0]).not.toContain('calendar');
    expect(adapter.groundingCalls[0]).not.toContain('tasks');
    expect(adapter.groundingCalls[0]).not.toContain('3 vessels');
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
    expect(adapter.groundingCalls[0]).toStartWith('UI snapshot r1');
    expect(adapter.groundingCalls[0]).toEndWith('…');
  });

  it('keeps a short custom summary intact inside the snapshot revision envelope', async () => {
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

    expect(adapter.groundingCalls).toHaveLength(1);
    expect(adapter.groundingCalls[0]).toContain('UI snapshot r1');
    expect(adapter.groundingCalls[0]).toEndWith(shortSummary);
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
    const { session, adapter, instance, events } = makeHarness(
      visibleWeatherSnapshot,
    );
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
    const c2Output = c2Result?.output as UpdateUIToolResult;
    expect(c2Output.ok).toBe(true);
    expect(c2Output.summary).toContain('1 vessel');
    expect(c2Output.summary).toContain('weather');

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

  for (const busy of [false, true]) {
    it(`keeps ${busy ? 'retried' : 'direct'} application settlement observable without sending into a replacement provider`, async () => {
      const { session, adapter, instance, events } = makeHarness();
      let release!: (result: SubmitIntentResult) => void;
      const submitted = new Promise<SubmitIntentResult>((resolve) => {
        release = resolve;
      });
      let attempts = 0;
      instance.submitIntent = () => {
        attempts += 1;
        if (busy && attempts === 1) {
          return Promise.reject(new RequestInFlightError());
        }
        return submitted;
      };
      await session.connect();
      adapter.emitToolCall({
        callId: 'retired',
        name: 'update_ui',
        argumentsJson: '{"intent":"show labs"}',
      });
      await flushMicrotasks();
      if (busy) {
        instance.settle();
        await flushMicrotasks();
      }
      expect(attempts).toBe(busy ? 2 : 1);
      await session.disconnect();
      await session.connect();
      release({ userMessage: 'Applied' });
      await flushMicrotasks();
      instance.settle();
      await flushMicrotasks();
      expect(adapter.toolResults).toHaveLength(0);
      expect(
        events.filter((event) => event.type === 'tool_result'),
      ).toMatchObject([{ callId: 'retired', ok: true }]);
      adapter.emitToolCall({
        callId: 'current',
        name: 'get_ui_state',
        argumentsJson: '{}',
      });
      await flushMicrotasks();
      expect(adapter.toolResults.map((result) => result.callId)).toEqual([
        'current',
      ]);
      expect(attempts).toBe(busy ? 2 : 1);
      await session.disconnect();
    });
  }

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
      ...inertInstanceMembers,
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
      ...inertInstanceMembers,
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
      ...inertInstanceMembers,
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
      ...inertInstanceMembers,
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
      ...inertInstanceMembers,
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
      visibleWeatherSnapshot,
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
    expect(output.summary).toContain('1 vessel');
    expect(output.summary).toContain('weather');
  });

  it('preserves the engine reply while the structural fallback describes visible Weather', async () => {
    const engineReply = 'Showing weekly Weather.';
    const { session, adapter, instance } = makeHarness(
      visibleWeatherSnapshot,
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
    expect(output.summary).toContain('1 vessel');
    expect(output.summary).toContain('weather');
    expect(output.summary).toContain('weekly');
    expect(output.summary).not.toContain('calendar');
    expect(output.summary).not.toContain('tasks');
    expect(output.summary).not.toContain('3 vessels');
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
      expect(call.callId).toBe(ToolCallId('c1'));
      expect(result.callId).toBe(ToolCallId('c1'));
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

  it('shares one provider cleanup across concurrent disconnect callers', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    const release = adapter.gateDisconnect();

    const first = session.disconnect();
    const second = session.disconnect();
    await flushMicrotasks();

    expect(adapter.disconnectCalls).toBe(1);
    expect(session.state).toBe('connected');

    release();
    await Promise.all([first, second]);

    expect(adapter.disconnectCalls).toBe(1);
    expect(session.state).toBe('idle');
  });

  it('preserves local teardown and rethrows the identical provider disconnect rejection', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    instance.emitEngineConnected(false);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });
    const rejection = new Error('provider disconnect failed');
    let localCleanupObserved = false;

    await session.connect();
    expect(session.greetingState).toBe('preparing');
    adapter.failNextDisconnect(rejection, () => {
      localCleanupObserved =
        adapter.listenerCount === 0 && instance.settledSubscriberCount === 0;
    });

    let thrown: unknown;
    try {
      await session.disconnect();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(rejection);
    expect(localCleanupObserved).toBe(true);
    expect(session.state).toBe('idle');
    expect(session.greetingState).toBe('pending');
    expect(session.lastError).toBeUndefined();
    expect(adapter.listenerCount).toBe(0);
    expect(instance.settledSubscriberCount).toBe(0);

    instance.emitEngineConnected(true);
    await flushMicrotasks();
    expect(session.greetingState).toBe('pending');
    expect(instance.acknowledged).toEqual([]);
  });

  it('shares cleanup with a disconnect re-entered synchronously by the adapter', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    const rejection = new Error('provider disconnect failed');
    let reentrant: Promise<void> | undefined;
    adapter.failNextDisconnect(rejection, () => {
      reentrant = session.disconnect();
    });

    const first = session.disconnect();

    expect(reentrant).toBe(first);
    await expect(first).rejects.toBe(rejection);
    expect(adapter.disconnectCalls).toBe(1);
    expect(session.state).toBe('idle');
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
      'DATA_CHANNEL_ERROR',
      'response.create send failed',
    );
    adapter.emitError(fatal);

    expect(session.state).toBe('error');
    expect(session.lastError).toBe(fatal);
    expect(adapter.listenerCount).toBe(0);
    expect(adapter.disconnectCalls).toBe(1);
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

  it('rejecting disconnect preserves lastError while moving the public state to idle', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();

    const fatal = new RealtimeVoiceError(
      'CONNECTION_FAILED',
      'ICE connection failed',
    );
    adapter.emitError(fatal);
    expect(session.state).toBe('error');
    expect(session.lastError).toBe(fatal);
    adapter.failNextDisconnect(new Error('provider disconnect failed'));

    await expect(session.disconnect()).rejects.toThrow(
      'provider disconnect failed',
    );

    expect(session.state).toBe('idle');
    expect(session.lastError).toBe(fatal);
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

// ============================================================================
// Greeting coordination (Phase 2)
// ============================================================================

describe('RealtimeSession — greeting activation and validation', () => {
  it('activates audio before adapter.connect and greets once after connected', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const events: SidechannelEvent[] = [];
    const transcripts: Array<{ role: string; text: string; final: boolean }> =
      [];
    const coordinator = new GreetingCoordinator();
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      onEvent: (e) => events.push(e),
      greeting: { text: 'Welcome back.', coordinator },
    });
    session.on('transcript', (t) => transcripts.push(t));

    // activateAudio must land inside the initiating gesture — before the
    // awaited adapter handshake.
    const release = adapter.gateConnect();
    const connecting = session.connect();
    await flushMicrotasks();
    expect(adapter.activateAudioCalls).toBe(1);
    expect(adapter.connectCalls).toBe(1);
    expect(instance.acknowledged).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);

    release();
    await connecting;
    await flushMicrotasks();

    expect(instance.acknowledged).toEqual([
      {
        id: coordinator.greetingIdFor(testSessionId),
        message: 'Welcome back.',
      },
    ]);
    expect(transcripts).toEqual([
      { role: 'assistant', text: 'Welcome back.', final: true },
    ]);
    expect(
      events.some(
        (e) =>
          e.type === 'transcript' &&
          e.role === 'assistant' &&
          e.text === 'Welcome back.' &&
          e.final === true,
      ),
    ).toBe(true);
    expect(adapter.speakCalls).toHaveLength(1);
    expect(adapter.speakCalls[0]?.text).toBe('Welcome back.');
    expect(adapter.speakCalls[0]?.id).toBe(
      coordinator.greetingIdFor(testSessionId),
    );
  });

  it('skips greeting-only adapter preparation after a completed greeting reconnects', async () => {
    const adapter = makeGreetingAdapter();
    const coordinator = new GreetingCoordinator();
    const session = new RealtimeSession({
      adapter,
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
      greeting: { text: 'Welcome back.', coordinator },
    });

    await session.connect();
    await flushMicrotasks();
    expect(adapter.connectOptions[0]?.prepareGreeting).toBe(true);
    expect(coordinator.getSnapshot(testSessionId).lifecycle).toBe('terminal');

    await session.disconnect();
    await session.connect();

    expect(adapter.connectOptions[1]?.prepareGreeting).toBe(false);
  });

  it('keeps greeting playback alive when transcript observers throw', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const coordinator = new GreetingCoordinator();
    const seen: string[] = [];
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      onEvent: () => {
        throw new Error('sidechannel observer failed');
      },
      greeting: { text: 'Welcome back.', coordinator },
    });
    session.on('transcript', () => {
      throw new Error('transcript observer failed');
    });
    session.on('transcript', (entry) => seen.push(entry.text));

    await session.connect();
    await flushMicrotasks();

    expect(seen).toEqual(['Welcome back.']);
    expect(adapter.speakCalls).toHaveLength(1);
    expect(coordinator.getSnapshot(testSessionId)).toEqual({
      lifecycle: 'terminal',
      reason: 'presented',
    });
  });

  it('rejects greeting config against a plain adapter before any provider connect', async () => {
    const adapter = makeMockAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: {
        text: 'hi',
        coordinator: new GreetingCoordinator(),
      },
    });

    await expect(session.connect()).rejects.toMatchObject({
      name: 'RealtimeVoiceError',
      code: 'GREETING_ADAPTER_UNSUPPORTED',
    });
    expect(session.state).toBe('error');
    expect(session.lastError).toBeInstanceOf(RealtimeVoiceError);
    expect(adapter.connectCalls).toBe(0);
    expect(instance.acknowledged).toEqual([]);
  });

  it('leaves connect behavior unchanged when greeting is not configured', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
    });

    await session.connect();
    await flushMicrotasks();

    expect(adapter.activateAudioCalls).toBe(0);
    expect(instance.acknowledged).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
  });
});

describe('RealtimeSession — greeting lifecycle', () => {
  it('stops before activation or provider setup when preparing synchronously disconnects', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });
    let disconnectPromise: Promise<void> | undefined;
    session.on('greeting_state', (state) => {
      if (state === 'preparing') disconnectPromise = session.disconnect();
    });

    await session.connect();
    await disconnectPromise;

    expect(session.state).toBe('idle');
    expect(session.greetingState).toBe('pending');
    expect(adapter.activateAudioCalls).toBe(0);
    expect(adapter.connectCalls).toBe(0);
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.listenerCount).toBe(0);
    expect(instance.settledSubscriberCount).toBe(0);
  });

  it('stops before activation or provider setup when connecting synchronously disconnects', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });
    let disconnectPromise: Promise<void> | undefined;
    session.on('state', (state) => {
      if (state === 'connecting') disconnectPromise = session.disconnect();
    });

    await session.connect();
    await disconnectPromise;

    expect(session.state).toBe('idle');
    expect(session.greetingState).toBe('pending');
    expect(adapter.activateAudioCalls).toBe(0);
    expect(adapter.connectCalls).toBe(0);
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.listenerCount).toBe(0);
    expect(instance.settledSubscriberCount).toBe(0);
  });

  it('retains preparing indefinitely while the provider is connected but Engine readiness is pending', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    instance.emitEngineConnected(false);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });
    const states: string[] = [];
    session.on('greeting_state', (state) => states.push(state));

    const connecting = session.connect();
    expect(session.greetingState).toBe('preparing');
    await connecting;
    adapter.emitTurnMode('manual', new Error('VAD unavailable'));
    await flushMicrotasks();

    expect(session.state).toBe('connected');
    expect(session.greetingState).toBe('preparing');
    expect(states).toEqual(['preparing']);
    expect(instance.acknowledged).toEqual([]);
  });

  it('skips during the Engine-readiness wait without starting later greeting work', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    instance.emitEngineConnected(false);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });

    await session.connect();
    expect(session.greetingState).toBe('preparing');
    session.skipGreeting();
    expect(session.greetingState).toBe('skipped');

    instance.emitEngineConnected(true);
    await flushMicrotasks();
    expect(instance.acknowledged).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
  });

  it('disconnect makes a pending Engine wait retryable and late readiness cannot settle the stale generation', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    instance.emitEngineConnected(false);
    const coordinator = new GreetingCoordinator();
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator },
    });
    await session.connect();
    expect(session.greetingState).toBe('preparing');

    await session.disconnect();
    expect(session.greetingState).toBe('pending');
    instance.emitEngineConnected(true);
    await flushMicrotasks();
    expect(session.greetingState).toBe('pending');
    expect(instance.acknowledged).toEqual([]);

    await session.connect();
    expect(session.greetingState).toBe('preparing');
  });

  it('skips synchronously before a gated provider handshake and retains the terminal state across reconnect and recreation', async () => {
    const coordinator = new GreetingCoordinator();
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const release = adapter.gateConnect();
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator },
    });
    const states: GreetingState[] = [];
    session.on('greeting_state', (state) => states.push(state));

    const connecting = session.connect();
    session.skipGreeting();
    session.skipGreeting();
    expect(session.greetingState).toBe('skipped');
    release();
    await connecting;
    await flushMicrotasks();
    expect(states.filter((state) => state === 'skipped')).toHaveLength(1);
    expect(instance.acknowledged).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
    expect(adapter.disconnectCalls).toBe(0);

    await session.disconnect();
    expect(session.greetingState).toBe('skipped');
    await session.connect();
    await flushMicrotasks();
    expect(instance.acknowledged).toEqual([]);

    const recreated = new RealtimeSession({
      adapter: makeGreetingAdapter(),
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator },
    });
    expect(recreated.greetingState).toBe('skipped');
  });

  it('retains Skip when it races a fatal adapter error and late Engine readiness', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    instance.emitEngineConnected(false);
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });

    await session.connect();
    session.skipGreeting();
    const fatal = new RealtimeVoiceError(
      'CONNECTION_FAILED',
      'connection failed after Skip',
    );
    adapter.emitError(fatal);
    instance.emitEngineConnected(true);
    await flushMicrotasks();

    expect(session.state).toBe('error');
    expect(session.lastError).toBe(fatal);
    expect(session.greetingState).toBe('skipped');
    expect(instance.acknowledged).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
  });

  it('skips during engine acknowledgement without starting caption or speech', async () => {
    const coordinator = new GreetingCoordinator();
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const release = instance.gateAck();
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator },
    });
    await session.connect();
    await flushMicrotasks();
    session.skipGreeting();
    release();
    await flushMicrotasks();

    expect(session.greetingState).toBe('skipped');
    expect(adapter.speakCalls).toEqual([]);
  });

  it('skips active speech once, aborts its generation, and preserves skipped across disconnect rejection', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    let releaseSpeak!: (result: GreetingSpeechResult) => void;
    adapter.setSpeakResult(
      () =>
        new Promise<GreetingSpeechResult>((resolve) => {
          releaseSpeak = resolve;
        }),
    );
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });
    const states: GreetingState[] = [];
    session.on('greeting_state', (state) => states.push(state));
    await session.connect();
    await flushMicrotasks();
    const signal = adapter.speakCalls[0]?.signal;

    session.skipGreeting();
    session.skipGreeting();
    expect(signal?.aborted).toBe(true);
    expect(session.greetingState).toBe('skipped');
    expect(states.filter((state) => state === 'skipped')).toHaveLength(1);
    adapter.failNextDisconnect(new Error('disconnect failed'));
    await expect(session.disconnect()).rejects.toThrow('disconnect failed');
    expect(session.greetingState).toBe('skipped');
    releaseSpeak('accepted');
    await flushMicrotasks();
    expect(session.greetingState).toBe('skipped');
  });

  it('does nothing when unconfigured and cannot rewrite accepted or suppressed terminal proof', async () => {
    const plain = makeMockAdapter();
    const unconfigured = new RealtimeSession({
      adapter: plain,
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
    });
    unconfigured.skipGreeting();
    expect(unconfigured.greetingState).toBe('not_configured');
    expect(plain.disconnectCalls).toBe(0);

    const presentedCoordinator = new GreetingCoordinator();
    const presented = new RealtimeSession({
      adapter: makeGreetingAdapter(),
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: presentedCoordinator },
    });
    await presented.connect();
    await flushMicrotasks();
    presented.skipGreeting();
    expect(presented.greetingState).toBe('settled');

    const suppressedAdapter = makeGreetingAdapter();
    const suppressedInstance = makeMockInstance(emptySnapshot);
    suppressedInstance.setAckResult('deduped');
    const suppressed = new RealtimeSession({
      adapter: suppressedAdapter,
      instance: suppressedInstance,
      sessionId: SessionId('suppressed-skip'),
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });
    await suppressed.connect();
    await flushMicrotasks();
    suppressed.skipGreeting();
    expect(suppressed.greetingState).toBe('settled');
  });

  it('allows a fresh session ID to greet normally after Skip', async () => {
    const coordinator = new GreetingCoordinator();
    const skipped = new RealtimeSession({
      adapter: makeGreetingAdapter(),
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator },
    });
    skipped.skipGreeting();
    expect(skipped.greetingState).toBe('skipped');

    const freshId = SessionId('fresh-after-skip');
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const fresh = new RealtimeSession({
      adapter,
      instance,
      sessionId: freshId,
      greeting: { text: 'Hello.', coordinator },
    });
    await fresh.connect();
    await flushMicrotasks();

    expect(fresh.greetingState).toBe('settled');
    expect(instance.acknowledged).toEqual([
      { id: coordinator.greetingIdFor(freshId), message: 'Hello.' },
    ]);
    expect(adapter.speakCalls).toHaveLength(1);
  });

  it('settles accepted greetings and initializes a recreated session synchronously from terminal proof', async () => {
    const coordinator = new GreetingCoordinator();
    const first = new RealtimeSession({
      adapter: makeGreetingAdapter(),
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator },
    });
    await first.connect();
    await flushMicrotasks();
    expect(first.greetingState).toBe('settled');

    const recreated = new RealtimeSession({
      adapter: makeGreetingAdapter(),
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator },
    });
    expect(recreated.greetingState).toBe('settled');
  });

  it('settles a not_started attempt but returns to preparing only on a later reconnect', async () => {
    const adapter = makeGreetingAdapter();
    adapter.setSpeakResult('not_started');
    const session = new RealtimeSession({
      adapter,
      instance: makeMockInstance(emptySnapshot),
      sessionId: testSessionId,
      greeting: { text: 'Hello.', coordinator: new GreetingCoordinator() },
    });
    await session.connect();
    await flushMicrotasks();
    expect(session.greetingState).toBe('settled');

    await session.disconnect();
    adapter.setSpeakResult('accepted');
    const reconnect = session.connect();
    expect(session.greetingState).toBe('preparing');
    await reconnect;
  });

  it('aborts an in-flight generation on disconnect', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const coordinator = new GreetingCoordinator();
    let speakSignal: AbortSignal | undefined;
    let resolveSpeak!: (value: GreetingSpeechResult) => void;
    adapter.setSpeakResult(
      () =>
        new Promise<GreetingSpeechResult>((resolve) => {
          resolveSpeak = resolve;
        }),
    );
    const originalSpeak = adapter.speakAssistantText.bind(adapter);
    adapter.speakAssistantText = async (args) => {
      speakSignal = args.signal;
      return originalSpeak(args);
    };

    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello there.', coordinator },
    });

    await session.connect();
    await flushMicrotasks();
    expect(adapter.speakCalls).toHaveLength(1);
    expect(speakSignal?.aborted).toBe(false);

    await session.disconnect();
    expect(speakSignal?.aborted).toBe(true);
    resolveSpeak('accepted');
    await flushMicrotasks();
  });

  it('does not re-greet the same session after a completed greeting + reconnect', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    const coordinator = new GreetingCoordinator();
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello there.', coordinator },
    });

    await session.connect();
    await flushMicrotasks();
    expect(instance.acknowledged).toHaveLength(1);
    expect(adapter.speakCalls).toHaveLength(1);

    await session.disconnect();

    const ackCountAfterFirst = instance.acknowledged.length;
    const speakCountAfterFirst = adapter.speakCalls.length;
    await session.connect();
    await flushMicrotasks();
    expect(instance.acknowledged.length).toBe(ackCountAfterFirst);
    expect(adapter.speakCalls.length).toBe(speakCountAfterFirst);
  });

  it('greets again when a new session reuses the same coordinator', async () => {
    const coordinator = new GreetingCoordinator();
    const sessionAId = SessionId('sess-a');
    const sessionBId = SessionId('sess-b');

    const adapterA = makeGreetingAdapter();
    const instanceA = makeMockInstance(emptySnapshot);
    const sessionA = new RealtimeSession({
      adapter: adapterA,
      instance: instanceA,
      sessionId: sessionAId,
      greeting: { text: 'Welcome.', coordinator },
    });
    await sessionA.connect();
    await flushMicrotasks();
    expect(instanceA.acknowledged).toHaveLength(1);
    expect(adapterA.speakCalls).toHaveLength(1);
    await sessionA.disconnect();

    const adapterB = makeGreetingAdapter();
    const instanceB = makeMockInstance(emptySnapshot);
    const sessionB = new RealtimeSession({
      adapter: adapterB,
      instance: instanceB,
      sessionId: sessionBId,
      greeting: { text: 'Welcome.', coordinator },
    });
    await sessionB.connect();
    await flushMicrotasks();
    expect(instanceB.acknowledged).toEqual([
      {
        id: coordinator.greetingIdFor(sessionBId),
        message: 'Welcome.',
      },
    ]);
    expect(adapterB.speakCalls).toHaveLength(1);
  });

  it('does not speak when acknowledgement fails', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    instance.setAckResult(new Error('history unavailable'));
    const coordinator = new GreetingCoordinator();
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello there.', coordinator },
    });

    await session.connect();
    await flushMicrotasks();

    expect(instance.acknowledged).toHaveLength(1);
    expect(adapter.speakCalls).toEqual([]);
  });

  it('retries not_started speech on the next connection generation', async () => {
    const adapter = makeGreetingAdapter();
    const instance = makeMockInstance(emptySnapshot);
    adapter.setSpeakResult('not_started');
    const coordinator = new GreetingCoordinator();
    const session = new RealtimeSession({
      adapter,
      instance,
      sessionId: testSessionId,
      greeting: { text: 'Hello there.', coordinator },
    });

    await session.connect();
    await flushMicrotasks();
    expect(adapter.speakCalls).toHaveLength(1);
    expect(instance.acknowledged).toHaveLength(1);

    await session.disconnect();
    adapter.setSpeakResult('accepted');
    await session.connect();
    await flushMicrotasks();

    // The retry re-acknowledges the retained inserted history before speaking.
    expect(adapter.speakCalls).toHaveLength(2);
    expect(instance.acknowledged).toHaveLength(2);
  });
});

// ============================================================================
// Observation and recovery equivalence
// ============================================================================

describe('RealtimeSession observation and recovery equivalence', () => {
  it('produces the observation snapshot and recovery memory that direct store and memory calls produce', async () => {
    const connectionIds = ['connection-1', 'connection-2'];
    const randomUUID = spyOn(crypto, 'randomUUID').mockImplementation(
      () =>
        (connectionIds.shift() ??
          'unexpected-connection') as `${string}-${string}-${string}-${string}-${string}`,
    );
    try {
      const adapter = makeMockAdapter();
      const feeds: Array<(event: AdapterVoiceObservation) => void> = [];
      Object.assign(adapter, {
        observations: {
          subscribe: (handler: (event: AdapterVoiceObservation) => void) => {
            feeds.push(handler);
            return () => {};
          },
        },
      });
      const instance = makeMockInstance(emptySnapshot);
      const session = new RealtimeSession({
        adapter,
        instance,
        sessionId: testSessionId,
      });
      const feed = (event: AdapterVoiceObservation) => feeds.at(-1)?.(event);

      await session.connect();
      feed({ type: 'fragment', fragment: firstUserFragment });
      feed({ type: 'fragment', fragment: revisedUserFragment });
      feed({ type: 'fragment', fragment: invalidFragment });
      feed({ type: 'media', media: { microphone: 'active' } });
      adapter.emitToolCall({
        callId: 'equivalence-1',
        name: 'update_ui',
        argumentsJson: JSON.stringify({ intent: 'show labs' }),
      });
      await flushMicrotasks();
      adapter.emitToolCall({
        callId: 'equivalence-2',
        name: 'update_ui',
        argumentsJson: JSON.stringify({ intent: 'show weather' }),
      });
      await flushMicrotasks();
      instance.settle();
      await flushMicrotasks();
      instance.settle();
      await flushMicrotasks();
      feed({ type: 'fragment', fragment: assistantFragment });
      adapter.emitError(
        new RealtimeVoiceError('DATA_CHANNEL_ERROR', 'connection lost'),
      );
      feed({ type: 'fragment', fragment: lateFragment });
      await session.connect();
      feed({ type: 'fragment', fragment: secondConnectionFragment });
      feed({ type: 'media', media: { incomingAudio: 'active' } });

      const store = new VoiceObservationStore();
      const memory = new RealtimeSessionMemory(testSessionId);
      const observe = (
        fragment: TimedTranscriptFragment,
        connectionId: string,
      ) => {
        store.fragment(fragment);
        const retained = store
          .getSnapshot()
          .fragments.find((value) => value.id === fragment.id);
        if (retained) memory.observe(retained, connectionId);
      };
      store.begin();
      store.connection('connected');
      observe(firstUserFragment, 'connection-1');
      observe(revisedUserFragment, 'connection-1');
      observe(invalidFragment, 'connection-1');
      store.media({ microphone: 'active' });
      memory.outcome({
        id: ToolCallId('equivalence-1'),
        intent: 'show labs',
        status: 'submitted',
      });
      memory.outcome({
        id: ToolCallId('equivalence-2'),
        intent: 'show weather',
        status: 'submitted',
      });
      memory.outcome({
        id: ToolCallId('equivalence-2'),
        intent: 'show weather',
        status: 'queued',
      });
      memory.outcome({
        id: ToolCallId('equivalence-1'),
        intent: 'show labs',
        status: 'completed',
        summary: 'The screen is empty.',
      });
      memory.outcome({
        id: ToolCallId('equivalence-2'),
        intent: 'show weather',
        status: 'submitted',
      });
      memory.outcome({
        id: ToolCallId('equivalence-2'),
        intent: 'show weather',
        status: 'completed',
        summary: 'The screen is empty.',
      });
      observe(assistantFragment, 'connection-1');
      store.connection('error');
      store.begin();
      store.connection('connected');
      observe(secondConnectionFragment, 'connection-2');
      store.media({ incomingAudio: 'active' });

      expect(session.observations.getSnapshot()).toEqual(store.getSnapshot());
      expect(session.memory.getSnapshot()).toEqual(memory.getSnapshot());

      await session.disconnect();
      store.connection('disconnecting');
      store.connection('disconnected');
      expect(session.observations.getSnapshot()).toEqual(store.getSnapshot());
      expect(session.memory.getSnapshot()).toEqual(memory.getSnapshot());
    } finally {
      randomUUID.mockRestore();
    }
  });

  it('stops a disposed session from feeding the memory it shares with its replacement', async () => {
    const memory = new RealtimeSessionMemory(testSessionId);
    const retiredAdapter = makeMockAdapter();
    const retiredInstance = makeMockInstance(emptySnapshot);
    const retired = new RealtimeSession({
      adapter: retiredAdapter,
      instance: retiredInstance,
      sessionId: testSessionId,
      memory,
    });
    await retired.connect();
    retiredAdapter.emitToolCall({
      callId: 'retired-call',
      name: 'update_ui',
      argumentsJson: JSON.stringify({ intent: 'show labs' }),
    });
    await flushMicrotasks();
    expect(memory.find(ToolCallId('retired-call'))?.status).toBe('submitted');

    await retired.dispose();
    await retired.dispose();
    retiredInstance.settle();
    await flushMicrotasks();

    expect(memory.find(ToolCallId('retired-call'))?.status).toBe('submitted');
    await expect(retired.connect()).rejects.toThrow('disposed');

    const replacementAdapter = makeMockAdapter();
    const replacementInstance = makeMockInstance(emptySnapshot);
    const replacement = new RealtimeSession({
      adapter: replacementAdapter,
      instance: replacementInstance,
      sessionId: testSessionId,
      memory,
    });
    await replacement.connect();
    replacementAdapter.emitToolCall({
      callId: 'replacement-call',
      name: 'update_ui',
      argumentsJson: JSON.stringify({ intent: 'show weather' }),
    });
    await flushMicrotasks();
    replacementInstance.settle();
    await flushMicrotasks();

    expect(memory.getSnapshot().outcomes).toEqual([
      {
        id: ToolCallId('retired-call'),
        intent: 'show labs',
        status: 'submitted',
      },
      {
        id: ToolCallId('replacement-call'),
        intent: 'show weather',
        status: 'completed',
        summary: 'The screen is empty.',
      },
    ]);
    await replacement.dispose();
  });

  it('keeps feeding shared memory after a plain disconnect, because submitted work can finish after voice ends', async () => {
    const { session, adapter, instance } = makeHarness();
    await session.connect();
    adapter.emitToolCall({
      callId: 'late-call',
      name: 'update_ui',
      argumentsJson: JSON.stringify({ intent: 'show labs' }),
    });
    await flushMicrotasks();

    await session.disconnect();
    instance.settle();
    await flushMicrotasks();

    expect(session.memory.find(ToolCallId('late-call'))?.status).toBe(
      'completed',
    );
  });

  it('does not repeat provider teardown or lifecycle notifications after disposal settles', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();

    await session.dispose();
    const snapshot = session.observations.getSnapshot();

    await session.dispose();
    expect(session.observations.getSnapshot()).toBe(snapshot);
    expect(adapter.disconnectCalls).toBe(1);
  });

  it('preserves a failed disposal result without retrying provider teardown', async () => {
    const { session, adapter } = makeHarness();
    await session.connect();
    const failure = new Error('provider teardown failed');
    adapter.failNextDisconnect(failure);

    await expect(session.dispose()).rejects.toBe(failure);
    const snapshot = session.observations.getSnapshot();
    await expect(session.dispose()).rejects.toBe(failure);

    expect(session.observations.getSnapshot()).toBe(snapshot);
    expect(adapter.disconnectCalls).toBe(1);
  });

  it('settles the observation snapshot as disconnected when disposed', async () => {
    const { session } = makeHarness();
    await session.connect();

    await session.dispose();

    expect(session.state).toBe('idle');
    expect(session.observations.getSnapshot().connection).toBe('disconnected');
  });
});

const firstUserFragment: TimedTranscriptFragment = {
  id: 'user-1',
  role: 'user',
  speakerId: 'user',
  text: 'show',
  startMs: 0,
  endMs: 200,
};

const revisedUserFragment: TimedTranscriptFragment = {
  ...firstUserFragment,
  text: 'show me the labs',
  endMs: 600,
};

const invalidFragment: TimedTranscriptFragment = {
  id: 'invalid-1',
  role: 'user',
  speakerId: 'user',
  text: 'backwards',
  startMs: 500,
  endMs: 100,
};

const assistantFragment: TimedTranscriptFragment = {
  id: 'assistant-1',
  role: 'assistant',
  speakerId: 'assistant',
  text: 'Here are your labs.',
  startMs: 900,
  endMs: 1400,
  final: true,
};

const lateFragment: TimedTranscriptFragment = {
  id: 'late-1',
  role: 'user',
  speakerId: 'user',
  text: 'after the drop',
  startMs: 1500,
  endMs: 1600,
};

const secondConnectionFragment: TimedTranscriptFragment = {
  id: 'user-2',
  role: 'user',
  speakerId: 'user',
  text: 'thanks',
  startMs: 0,
  endMs: 300,
};
