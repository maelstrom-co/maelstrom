import type { DiagnosticMetadata } from '@maelstrom-co/protocol';
import type { TelemetryAttachment } from '@maelstrom-co/telemetry';
import {
  type OperationalKind,
  type OperationalMetadata,
  operationalKinds,
} from '@maelstrom-co/telemetry/integration';
import type { RealtimeSession } from './realtime-session/realtime-session.js';
import type { ToolCallEvent } from './realtime-session/session-event-bus.js';
import {
  type ToolInvocation,
  toolInvocation,
} from './realtime-session/tool-invocation.js';

export const DEFAULT_PENDING_TOOLS = 1_000;
export const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DIAGNOSTIC_PENDING_TOOLS = 1_000;
type ToolKind = Extract<OperationalKind, `voice.tool.${string}`>;
type ToolObservation = {
  [Kind in ToolKind]: {
    readonly kind: Kind;
    readonly metadata: OperationalMetadata[Kind];
  };
}[ToolKind];

function projectToolObservation(
  event: ToolCallEvent,
  invocation: ToolInvocation | undefined,
): ToolObservation {
  const identity = {
    generation: event.generation,
    generationScope: 'session',
    callId: event.callId,
  };
  switch (event.type) {
    case 'tool.called':
      return {
        kind: operationalKinds.voiceToolCalled,
        metadata: { ...identity, tool: event.name },
      };
    case 'tool.cancelled':
      return {
        kind: operationalKinds.voiceToolCancelled,
        metadata: { ...identity, outcome: 'cancelled' },
      };
    case 'tool.result':
      return {
        kind: operationalKinds.voiceToolResult,
        metadata: {
          ...identity,
          ok: event.ok,
          durationMs: invocation?.durationMs ?? event.latencyMs,
          ...invocation?.result,
        },
      };
  }
}

type ToolPolicy =
  | {
      mode: 'telemetry';
      maxPendingTools: number;
      drainTimeoutMs: number;
      reportLoss(): void;
    }
  | { mode: 'diagnostics'; observed(): boolean };

export function observeTools(
  session: Pick<RealtimeSession, 'events'>,
  policy: ToolPolicy,
  publish: (
    event: ToolCallEvent,
    metadata: DiagnosticMetadata,
    kind: OperationalKind,
  ) => void,
): TelemetryAttachment & { cancel(): void } {
  const calls = new Set<string | symbol>();
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const drain = { promise, resolve, reject };
  let state:
    | { readonly phase: 'observing' }
    | { readonly phase: 'draining'; timer?: ReturnType<typeof setTimeout> }
    | { readonly phase: 'closed' } = { phase: 'observing' };
  let unsubscribe = () => {};
  const finish = () => {
    if (state.phase !== 'draining' || calls.size) return;
    clearTimeout(state.timer);
    state = { phase: 'closed' };
    try {
      unsubscribe();
      drain.resolve();
    } catch (error) {
      drain.reject(error);
    }
  };
  unsubscribe = session.events.subscribe((event) => {
    if (
      state.phase === 'closed' ||
      (event.type !== 'tool.called' &&
        event.type !== 'tool.result' &&
        event.type !== 'tool.cancelled')
    )
      return;
    const invocation = toolInvocation(event);
    const key =
      invocation?.id ?? JSON.stringify([event.generation, event.callId]);
    const observed = policy.mode === 'telemetry' || policy.observed();
    if (event.type === 'tool.called') {
      if (state.phase !== 'observing' || !observed) return;
      if (policy.mode === 'telemetry') {
        if (!invocation || calls.has(key)) return;
        if (calls.size >= policy.maxPendingTools) {
          policy.reportLoss();
          return;
        }
      }
      calls.add(key);
      if (
        policy.mode === 'diagnostics' &&
        calls.size > DIAGNOSTIC_PENDING_TOOLS
      ) {
        const first = calls.values().next().value;
        if (first !== undefined) calls.delete(first);
      }
    } else {
      const owned = calls.delete(key);
      if (
        (state.phase !== 'observing' || policy.mode === 'telemetry') &&
        !owned
      )
        return;
      if (!observed) {
        finish();
        return;
      }
    }
    try {
      const observation = projectToolObservation(event, invocation);
      publish(event, observation.metadata, observation.kind);
    } finally {
      finish();
    }
  });
  return {
    drained: drain.promise,
    release() {
      if (state.phase !== 'observing') return;
      state = { phase: 'draining' };
      if (policy.mode === 'telemetry' && calls.size) {
        state.timer = setTimeout(() => {
          const abandoned = calls.size;
          calls.clear();
          try {
            for (let i = 0; i < abandoned; i++) policy.reportLoss();
          } finally {
            finish();
          }
        }, policy.drainTimeoutMs);
      }
      finish();
    },
    cancel() {
      if (state.phase === 'closed') return;
      if (state.phase === 'observing') state = { phase: 'draining' };
      calls.clear();
      finish();
    },
  };
}
