import type { AgentEvent, SessionId } from '@maelstrom-co/protocol';
import type { Logger } from '../logger.js';
import { createInputAdmission } from './input-admission.js';
import { createOrderedEmitter } from './ordered-emitter.js';
import {
  createRunScheduler,
  type RunObserver,
  type UiChangePlanner,
} from './run-scheduler.js';

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
   * Maximum wait in milliseconds for the browser to acknowledge a UI change
   * with `ui_applied`. Defaults to 30,000. Must be a positive integer no
   * greater than 2,147,483,647, or opening the connection throws. When it
   * elapses, the run finishes with code `ui_ack_timeout`, every queued
   * utterance finishes as `cancelled`, and the next utterance plans against
   * its own Chart.
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
 *   default. A timeout fails the run and cancels queued work.
 */
export interface AgentConnection {
  /** Accepts untrusted input. Resolves after handling it, without waiting for a later UI acknowledgement. */
  send(input: unknown): Promise<void>;
  /** Observes future events in emission order. Returns an unsubscribe function; there is no replay. */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /** Aborts pending work and releases listeners. Idempotent; no later events are emitted. */
  close(): void;
}

export function createAgentConnection(
  options: OpenConnectionOptions,
  plan: UiChangePlanner,
  observe: RunObserver,
  logger: Logger,
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
  const runs = createRunScheduler({
    plan,
    observe,
    events,
    signal: controller.signal,
    clock,
    acknowledgementTimeoutMs,
  });
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
      if (admitted.kind === 'rejected') events.emit(admitted.event);
      else if (admitted.kind === 'acknowledgement')
        runs.acknowledge(admitted.input);
      else if (admitted.kind === 'utterance')
        await runs.enqueue(admitted.input);
    },
  };
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
