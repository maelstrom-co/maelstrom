import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentFinishReason,
  AgentInputSchema,
  type AgentUiChangeEvent,
  type AgentUtteranceInput,
  ChangeId,
  type ChartRequest,
  type DiagnosticMetadata,
  isErr,
  type MaelstromResponse,
  type MessageId,
  MessageIdSchema,
  type Result,
  RunId,
  type SessionId,
} from '@maelstrom-co/protocol';
import type { EngineError } from '../errors.js';
import type { Logger } from '../logger.js';

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
  /** Maximum wait for UI application before the run fails. Defaults to 30,000 milliseconds. */
  readonly acknowledgementTimeoutMs?: number;
}

/** One connection's ordered Agent Session event stream. */
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
  const listeners = new Set<(event: AgentEvent) => void>();
  const pending = new Map<ChangeId, PendingChange>();
  const seen = new Set<MessageId>();
  const controller = new AbortController();
  const queue: UiRun[] = [];
  let current: UiRun | undefined;
  let chart: ChartRequest | undefined;
  let closed = false;
  let emitting = false;
  const notifications: AgentEvent[] = [];
  const emit = (...events: AgentEvent[]) => {
    if (closed) return;
    notifications.push(...events);
    if (emitting) return;
    emitting = true;
    try {
      while (!closed && notifications.length) {
        const event = notifications.shift();
        if (!event) break;
        try {
          logger.debug(
            `agent.${event.type}`,
            eventLogData(options.sessionId, event),
          );
        } catch {
          /* A failing logger cannot interrupt connection work or observers. */
        }
        for (const listener of [...listeners]) {
          if (closed) break;
          try {
            const result: unknown = listener(event);
            if (
              result &&
              (typeof result === 'object' || typeof result === 'function') &&
              'then' in result
            )
              void Promise.resolve(result).catch(() => {});
          } catch {
            /* One observer cannot interrupt connection work or other observers. */
          }
        }
      }
    } finally {
      emitting = false;
    }
  };
  const complete = (
    run: UiRun,
    reply: string,
    failure?: {
      readonly error: string;
      readonly code: string;
      readonly reason?: AgentFinishReason;
    },
  ) => {
    const { runId } = run;
    const reason = failure?.reason ?? (failure ? 'error' : 'completed');
    const metrics = {
      turns: 0,
      toolCalls: 0,
      elapsedMs: Math.max(0, Math.round(clock() - run.started)),
      inputTokens: 0,
      outputTokens: 0,
    };
    const message: AgentEvent[] = failure
      ? []
      : [
          {
            type: 'message',
            version: AGENT_WIRE_VERSION,
            runId,
            turnId: `${runId}:reply`,
            delta: reply,
          },
        ];
    emit(...message, {
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId,
      ...failure,
      ok: !failure,
      reason,
      reply: failure ? '' : reply,
      metrics,
    });
    observe(runId, run.input.inputId, 'engine.agent.run.finished', {
      reason,
      outcome: failure ? 'failed' : 'succeeded',
      ...metrics,
      ...(failure ? { code: failure.code } : {}),
    });
  };
  const pump = async (): Promise<void> => {
    if (closed || emitting || current) return;
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
    emit(event);
    observe(runId, input.inputId, 'engine.agent.ui_change.emitted', {
      changeId: event.changeId,
      actions: event.response.executionPlan.length,
    });
    run.ready.resolve();
    void pump();
  };
  return {
    subscribe(listener) {
      if (!closed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      controller.abort();
      for (const change of pending.values()) change.cancelTimeout();
      pending.clear();
      seen.clear();
      current?.ready.resolve();
      current = undefined;
      for (const run of queue) run.ready.resolve();
      queue.length = 0;
      chart = undefined;
      listeners.clear();
      notifications.length = 0;
    },
    async send(raw) {
      if (closed) return;
      const decoded = AgentInputSchema.safeParse(raw);
      if (!decoded.success) {
        const inputId = MessageIdSchema.safeParse(
          raw && typeof raw === 'object' && 'inputId' in raw
            ? raw.inputId
            : undefined,
        );
        emit({
          type: 'error',
          version: AGENT_WIRE_VERSION,
          ...(inputId.success ? { inputId: inputId.data } : {}),
          code: 'invalid_input',
          error: 'Invalid Agent Session input.',
        });
        return;
      }
      const input = decoded.data;
      if (input.type === 'ui_applied') {
        const change = pending.get(input.changeId);
        if (change) {
          if (
            input.actionOutcomes.length !==
            change.event.response.executionPlan.length
          ) {
            emit({
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
          emit({
            type: 'error',
            version: AGENT_WIRE_VERSION,
            changeId: input.changeId,
            code: 'unknown_change',
            error: 'Unknown UI change.',
          });
        return;
      }
      if (seen.has(input.inputId)) return;
      if (queue.length + (current ? 1 : 0) >= 32) {
        emit({
          type: 'error',
          version: AGENT_WIRE_VERSION,
          inputId: input.inputId,
          code: 'queue_full',
          error: 'The connection already has 32 pending inputs.',
        });
        return;
      }
      if (seen.size >= 4096) {
        emit({
          type: 'error',
          version: AGENT_WIRE_VERSION,
          inputId: input.inputId,
          code: 'session_capacity',
          error: 'Open a new connection before sending more inputs.',
        });
        return;
      }
      seen.add(input.inputId);
      const started = clock();
      const runId = RunId(crypto.randomUUID());
      let resolve = () => {};
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      const ready = { promise, resolve };
      if (!current && queue.length === 0) chart = input.chart;
      queue.push({ input, runId, started, ready });
      emit(
        {
          type: 'placeholder',
          version: AGENT_WIRE_VERSION,
          inputId: input.inputId,
          text: 'One moment.',
        },
        {
          type: 'accepted',
          version: AGENT_WIRE_VERSION,
          inputId: input.inputId,
          runId,
          disposition: 'ui_only',
          ack: 'On it.',
        },
      );
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
