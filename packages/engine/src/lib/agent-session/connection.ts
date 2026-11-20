import type { AgentEvent, SessionId } from '@maelstrom-co/protocol';

import { assertNever } from '../assert-never.js';
import type { Logger } from '../logger.js';
import type { ResolvedAgentConfig } from './agent-config.js';
import type { DiagnosticObservers } from './agent-diagnostics.js';
import { type AgentRunQueue, createAgentRunQueue } from './agent-run-queue.js';
import type { AgentRunClock } from './agent-run.js';
import { createInputAdmission } from './input-admission.js';
import {
  createOrderedEmitter,
  type OrderedEmitter,
} from './ordered-emitter.js';
import { createRunScheduler, type RunScheduler } from './run-scheduler.js';
import { createScreenChangeQueue } from './screen-change-queue.js';
import type { SessionPlanner } from './session-planner.js';
import { createToolResultStore } from './tool-result-store.js';
import { createTranscript, TRANSCRIPT_MAX_CHARS } from './transcript.js';

/** Server-owned context and clock for one connection. Never supplied to the Planner. */
export interface OpenConnectionOptions {
  /** Session the host authorized before opening this connection. */
  readonly sessionId: SessionId;
  /** Host-authenticated principal, opaque to the UI-only route. Use null for anonymous applications. */
  readonly user: unknown;
  /** Optional application credential. Provider API keys do not belong here. */
  readonly token?: string;
  /** Browser capability manifest, opaque until Client Tools are configured. */
  readonly capabilities?: unknown;
  /** Monotonic millisecond clock for measuring run duration. Defaults to performance.now. */
  readonly clock?: () => number;
  /**
   * Schedules a callback after a delay in milliseconds and returns a function
   * that cancels it. Agent Runs use it for their deadline. Defaults to
   * `globalThis.setTimeout`, cancelled with `globalThis.clearTimeout`.
   */
  readonly scheduleTimeout?: AgentRunClock['scheduleTimeout'];
  /**
   * Maximum wait in milliseconds for the browser to acknowledge a UI change
   * with `ui_applied`. Defaults to 30,000. Must be a positive integer no
   * greater than 2,147,483,647, or opening the connection throws. On the
   * UI-only route, when it elapses, the run finishes with code
   * `ui_ack_timeout`, every queued utterance finishes as `cancelled`, and the
   * next utterance plans against its own Chart. A `change_screen` change of
   * an Agent Run waits as long, then its goals answer `unknown` and the next
   * queued Screen Change starts on the last acknowledged Chart.
   */
  readonly acknowledgementTimeoutMs?: number;
}

/**
 * One connection's ordered Agent Session event stream.
 *
 * Capacity is bounded per connection:
 * - At most 32 utterances are pending, including the one being planned or
 *   awaiting acknowledgement. A further utterance receives an `error` event
 *   with code `queue_full` and is not remembered, so it can be sent again.
 * - At most 4,096 input IDs are remembered, with no eviction, so a repeated
 *   input is always ignored. After that, a new utterance receives an `error`
 *   event with code `session_capacity`. The host must open a new connection
 *   to continue.
 * - Each UI change waits for acknowledgement for at most
 *   {@link OpenConnectionOptions.acknowledgementTimeoutMs}, 30 seconds by
 *   default. On the UI-only route a timeout fails the run and cancels queued
 *   work. On an agent connection a timeout of a `change_screen` change
 *   answers its goals `unknown` and lets the next queued Screen Change start.
 */
export interface AgentConnection {
  /**
   * Accepts untrusted input. Resolves after handling it, without waiting for
   * a later UI acknowledgement. Input sent after close() is dropped without an
   * event or a diagnostic.
   */
  send(input: unknown): Promise<void>;
  /** Observes future events in emission order. Returns an unsubscribe function; there is no replay. */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /** Aborts pending work and releases listeners. Idempotent; no later events are emitted. */
  close(): void;
}

/** What the Engine wires into each {@link AgentConnection}. */
export interface AgentConnectionDependencies {
  /** Plans every UI change of the connection, on either route. */
  readonly planner: SessionPlanner;
  /**
   * Receives diagnostic observations of each run and change, and those that
   * belong to no run: ignored and rejected inputs and acknowledgements for an
   * unknown change.
   */
  readonly diagnostics: DiagnosticObservers;
  /** Receives delivered events and run failures. */
  readonly logger: Logger;
  /** The resolved agent slot. Without it every utterance takes the UI-only route. */
  readonly agent?: ResolvedAgentConfig;
}

export function createAgentConnection(
  options: OpenConnectionOptions,
  { planner, diagnostics, logger, agent }: AgentConnectionDependencies,
): AgentConnection {
  const clock = options.clock ?? (() => performance.now());
  const acknowledgementTimeoutMs = options.acknowledgementTimeoutMs ?? 30_000;
  if (
    !Number.isSafeInteger(acknowledgementTimeoutMs) ||
    acknowledgementTimeoutMs <= 0 ||
    acknowledgementTimeoutMs > 2_147_483_647
  )
    throw new Error(
      'acknowledgementTimeoutMs must be a positive timer duration.',
    );
  const controller = new AbortController();
  const events = createOrderedEmitter<AgentEvent>({
    onDeliver: (event) =>
      logger.debug(
        `agent.${event.type}`,
        eventLogData(options.sessionId, event),
      ),
  });
  const admission = createInputAdmission();
  const runs =
    agent === undefined
      ? createRunScheduler({
          planner,
          diagnostics,
          logger,
          events,
          signal: controller.signal,
          clock,
          acknowledgementTimeoutMs,
        })
      : agentRuns(
          createAgentRoute({
            options,
            agent,
            planner,
            diagnostics,
            logger,
            events,
            clock,
            acknowledgementTimeoutMs,
          }),
          events,
        );
  return {
    subscribe: (listener) => events.subscribe(listener),
    close() {
      if (controller.signal.aborted) return;
      events.close();
      controller.abort();
      runs.close();
      admission.forget();
    },
    async send(raw) {
      if (controller.signal.aborted) return;
      const admitted = admission.admit(raw, runs.pendingRuns());
      switch (admitted.kind) {
        case 'rejected': {
          const { code, inputId } = admitted.event;
          diagnostics.session('engine.agent.input.rejected', {
            code,
            ...(inputId === undefined ? {} : { inputId }),
          });
          runs.reject(admitted.event);
          return;
        }
        case 'ignored':
          diagnostics.session('engine.agent.input.ignored', {
            inputId: admitted.inputId,
            reason: 'duplicate_input',
          });
          return;
        case 'acknowledgement':
          runs.acknowledge(admitted.input);
          return;
        case 'utterance':
          await runs.enqueue(admitted.input);
          return;
        default:
          assertNever(admitted, 'agent input admission');
      }
    },
  };
}

function createAgentRoute({
  options,
  agent,
  planner,
  diagnostics,
  logger,
  events,
  clock,
  acknowledgementTimeoutMs,
}: {
  readonly options: OpenConnectionOptions;
  readonly agent: ResolvedAgentConfig;
  readonly planner: SessionPlanner;
  readonly diagnostics: DiagnosticObservers;
  readonly logger: Logger;
  readonly events: OrderedEmitter<AgentEvent>;
  readonly clock: () => number;
  readonly acknowledgementTimeoutMs: number;
}): AgentRunQueue {
  const scheduleTimeout = options.scheduleTimeout ?? scheduleGlobalTimeout;
  const transcript = createTranscript({ maxChars: TRANSCRIPT_MAX_CHARS });
  const screenChanges = createScreenChangeQueue({
    planner,
    events,
    diagnostics,
    recordScreenNote: (runId, turnId, text) =>
      transcript.recordScreenNote(runId, turnId, text),
    logger,
    scheduleTimeout,
    acknowledgementTimeoutMs,
  });
  return createAgentRunQueue({
    agent,
    identity: {
      user: options.user,
      ...(options.token === undefined ? {} : { token: options.token }),
    },
    events,
    observe: diagnostics.run,
    logger,
    clock,
    scheduleTimeout,
    screenChanges,
    transcript,
    toolResults: createToolResultStore(),
  });
}

function agentRuns(
  queue: AgentRunQueue,
  events: OrderedEmitter<AgentEvent>,
): RunScheduler {
  return {
    pendingRuns: () => queue.pendingRuns(),
    reject: (event) => events.emit(event),
    enqueue: (input) => queue.enqueue(input),
    acknowledge: (input) => queue.acknowledge(input),
    close: () => queue.close(),
  };
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** The timer functions used to schedule the deadline. */
export interface DeadlineTimers {
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: never) => void;
}

/**
 * Runs `callback` after `ms`, chaining timers when the delay exceeds the
 * platform limit. A non-finite delay never fires. Returns a cancel function.
 */
export function scheduleGlobalTimeout(
  callback: () => void,
  ms: number,
  timers: DeadlineTimers = globalThis,
): () => void {
  if (!Number.isFinite(ms)) return () => undefined;
  let remaining = Math.max(0, ms);
  let handle: unknown;
  const arm = (): void => {
    const step = Math.min(remaining, MAX_TIMER_DELAY_MS);
    remaining -= step;
    handle = timers.setTimeout(remaining > 0 ? arm : callback, step);
  };
  arm();
  return () => timers.clearTimeout(handle as never);
}

function eventLogData(
  sessionId: SessionId,
  event: AgentEvent,
): Record<string, unknown> {
  const fields = [
    'inputId',
    'runId',
    'changeId',
    'disposition',
    'reason',
    'ok',
    'code',
  ];
  const data: Record<string, unknown> = { sessionId };
  for (const [key, value] of Object.entries(event))
    if (value !== undefined && fields.includes(key)) data[key] = value;
  return data;
}
