import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentUiChangeEvent,
  type AgentUtteranceInput,
  ChangeId,
  type ChartRequest,
  type DiagnosticMetadata,
  isErr,
  type MaelstromResponse,
  type MessageId,
  type Result,
  RunId,
  type SessionId,
} from '@maelstrom-co/protocol';
import type { EngineError } from '../errors.js';
import type { Logger } from '../logger.js';
import { createInputAdmission } from './input-admission.js';
import { createOrderedEmitter } from './ordered-emitter.js';
import {
  buildAcceptanceEvents,
  buildRunEnding,
  type RunFailure,
} from './run-events.js';

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

interface UiPlanInput {
  readonly request: ChartRequest;
  readonly messageId: MessageId;
  readonly runId: RunId;
  readonly signal: AbortSignal;
}

interface PendingChange {
  readonly event: AgentUiChangeEvent;
  readonly run: UiRun;
  readonly cancelTimeout: () => void;
}

interface UiRun {
  readonly input: AgentUtteranceInput;
  readonly runId: RunId;
  readonly started: number;
  readonly ready: {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
  };
}

export function createAgentConnection(
  options: OpenConnectionOptions,
  plan: (input: UiPlanInput) => Promise<Result<MaelstromResponse, EngineError>>,
  observe: (
    runId: RunId,
    inputId: MessageId,
    kind: string,
    metadata: DiagnosticMetadata,
    readContent?: () => unknown,
  ) => void,
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
  const pending = new Map<ChangeId, PendingChange>();
  const admission = createInputAdmission();
  const controller = new AbortController();
  const queue: UiRun[] = [];
  let current: UiRun | undefined;
  let chart: ChartRequest | undefined;
  let closed = false;
  const events = createOrderedEmitter<AgentEvent>({
    onDeliver: (event) =>
      logger.debug(
        `agent.${event.type}`,
        eventLogData(options.sessionId, event),
      ),
  });
  const complete = (run: UiRun, reply: string, failure?: RunFailure) => {
    const ending = buildRunEnding(run, clock(), reply, failure);
    events.emit(...ending.events);
    observe(
      run.runId,
      run.input.inputId,
      'engine.agent.run.finished',
      ending.metadata,
    );
  };
  const pump = async (): Promise<void> => {
    if (closed || events.isDelivering() || current) return;
    const run = queue.shift();
    if (!run) return;
    current = run;
    const { input, runId } = run;
    const { skipReply: _skipReply, ...snapshot } = chart ?? input.chart;
    let result: Awaited<ReturnType<typeof plan>>;
    try {
      result = await plan({
        messageId: input.inputId,
        runId,
        signal: controller.signal,
        request: {
          ...snapshot,
          context: {
            ...snapshot.context,
            updateReasons: [{ type: 'user_intent', intent: input.text }],
          },
        },
      });
    } catch {
      if (!closed)
        complete(run, '', {
          code: 'internal_error',
          error: 'The UI request failed.',
        });
      current = undefined;
      run.ready.resolve();
      void pump();
      return;
    }
    if (closed) return;
    if (isErr(result)) {
      complete(run, '', {
        error: 'The UI request failed.',
        code: result.error._tag,
      });
      current = undefined;
      run.ready.resolve();
      void pump();
      return;
    }
    const event: AgentUiChangeEvent = {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId: ChangeId(crypto.randomUUID()),
      response: result.value,
    };
    const timeout = setTimeout(() => {
      const change = pending.get(event.changeId);
      if (!change || closed) return;
      pending.delete(event.changeId);
      chart = undefined;
      const abandoned = queue.splice(0);
      complete(run, '', {
        code: 'ui_ack_timeout',
        error: 'The UI acknowledgement did not arrive.',
      });
      for (const queued of abandoned) {
        if (!closed)
          complete(queued, '', {
            reason: 'cancelled',
            code: 'ui_ack_timeout',
            error: 'The preceding UI change was not acknowledged.',
          });
        queued.ready.resolve();
      }
      current = undefined;
      void pump();
    }, acknowledgementTimeoutMs);
    pending.set(event.changeId, {
      event,
      run,
      cancelTimeout: () => clearTimeout(timeout),
    });
    events.emit(event);
    observe(runId, input.inputId, 'engine.agent.ui_change.emitted', {
      changeId: event.changeId,
      actions: event.response.executionPlan.length,
    });
    run.ready.resolve();
    void pump();
  };
  return {
    subscribe: (listener) => events.subscribe(listener),
    close() {
      if (closed) return;
      closed = true;
      events.close();
      controller.abort();
      for (const change of pending.values()) change.cancelTimeout();
      pending.clear();
      admission.forget();
      current?.ready.resolve();
      current = undefined;
      for (const run of queue) run.ready.resolve();
      queue.length = 0;
      chart = undefined;
    },
    async send(raw) {
      if (closed) return;
      const admitted = admission.admit(raw, queue.length + (current ? 1 : 0));
      if (admitted.kind === 'rejected') {
        events.emit(admitted.event);
        return;
      }
      if (admitted.kind === 'ignored') return;
      const { input } = admitted;
      if (input.type === 'ui_applied') {
        const change = pending.get(input.changeId);
        if (change) {
          if (
            input.actionOutcomes.length !==
            change.event.response.executionPlan.length
          ) {
            events.emit({
              type: 'error',
              version: AGENT_WIRE_VERSION,
              changeId: input.changeId,
              code: 'invalid_action_outcomes',
              error: 'Expected one outcome per Action.',
            });
            return;
          }
          pending.delete(input.changeId);
          change.cancelTimeout();
          chart = input.chart;
          observe(
            change.run.runId,
            change.run.input.inputId,
            'engine.agent.ui_change.applied',
            {
              changeId: input.changeId,
              actions: input.actionOutcomes.length,
              failed: input.actionOutcomes.filter((outcome) => !outcome.ok)
                .length,
            },
            () => ({
              chart: input.chart,
              actionOutcomes: input.actionOutcomes,
            }),
          );
          if (!closed)
            complete(
              change.run,
              change.event.response.userMessage,
              input.actionOutcomes.some((outcome) => !outcome.ok)
                ? {
                    code: 'ui_apply_failed',
                    error: 'The UI change could not be fully applied.',
                  }
                : undefined,
            );
          current = undefined;
          void pump();
        } else
          events.emit({
            type: 'error',
            version: AGENT_WIRE_VERSION,
            changeId: input.changeId,
            code: 'unknown_change',
            error: 'Unknown UI change.',
          });
        return;
      }
      const started = clock();
      const runId = RunId(crypto.randomUUID());
      let resolve = () => {};
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      const ready = { promise, resolve };
      // A Chart sent while a change awaits acknowledgement can predate it.
      if (pending.size === 0) chart = input.chart;
      queue.push({ input, runId, started, ready });
      events.emit(...buildAcceptanceEvents(input.inputId, runId));
      observe(
        runId,
        input.inputId,
        'engine.agent.input.accepted',
        { source: input.source, disposition: 'ui_only' },
        () => ({ text: input.text }),
      );
      void pump();
      await ready.promise;
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
