import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
} from '@maelstrom-co/client';
import { RequestInFlightError } from '@maelstrom-co/client';
import type { MessageId, SidechannelEvent } from '@maelstrom-co/protocol';
import { SessionId, ToolCallId } from '@maelstrom-co/protocol';

import type {
  AdapterAudioStreams,
  AdapterConnectOptions,
  AdapterTurnControl,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
} from '../provider-adapter.types.js';
import { RealtimeSession } from '../realtime-session.js';
import type {
  RealtimeInstance,
  SubmitIntentResult,
} from '../realtime-session.types.js';

export function makeHarness(
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

export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface MockAdapter extends RealtimeProviderAdapter {
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

export function makeMockAdapter(): MockAdapter {
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

export const emptyCapabilitySnapshot: CapabilitySnapshot = { vessels: [] };

export interface MockInstance extends RealtimeInstance {
  readonly submitted: string[];
  readonly acknowledged: Array<{ id: MessageId; message: string }>;
  /** Resolves pending waitForIdle() calls and clears the in-flight submitIntent gate — a full render settle. */
  settle(): void;
  /**
   * Resolves pending waitForIdle() calls WITHOUT clearing the in-flight
   * gate — simulates the command queue going idle while the orchestrator's
   * engine round-trip (and thus `RequestInFlightError`) is still ongoing,
   * application readiness is therefore not established by idle alone.
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

export function makeMockInstance(
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

export const testSessionId = SessionId('sess-test-1');

export const emptySnapshot: UIStructuralSnapshot = {
  instances: [],
  layout: null,
  layoutMode: 'grid',
  chartDimensions: { rows: 8, columns: 12 },
};
