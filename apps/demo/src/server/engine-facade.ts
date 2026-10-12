// PROTOTYPE (MAE-826): throwaway Engine facade, never merge.
/**
 * Demo-local stand-in for the Engine's intended role, one per connection.
 * Every engine-bound frame goes through {@link EngineFacade.handle}: Agent
 * Session input, client tool results, UI acks, and the browser's own
 * chart_request envelopes (chart resize, Vessel mutations). The facade hosts
 * the Agent Session, owns the one FIFO Planner queue (at most one Planner
 * call in flight), and emits every client event. The wrapped
 * `@maelstrom-co/engine` instance is used only as the Planner.
 */
import { type Engine, recoverCorrelation } from '@maelstrom-co/engine';
import {
  AssistantMessageResultMessage,
  ChartRequestMessage,
  ChartRequestSchema,
  decodeClientEnvelope,
  EngineErrorMessage,
  encodeEnvelope,
  HistoryResponseMessage,
  isErr,
  type MaelstromResponse,
  MaelstromResponseMessage,
  type MessageId,
  type ServerEnvelope,
  SessionId,
  type UpdateReason,
} from '@maelstrom-co/protocol';
import {
  type PlannerCallOrigin,
  type PlannerIntent,
  plannerIntentText,
  registerPlannerIntent,
} from './agent-planner';
import { AgentSession } from './agent-session';
import {
  type AgentChartSnapshot,
  type AgentClientFrame,
  type AgentServerFrame,
  type AgentUiAppliedFrame,
  type AgentUiFrame,
  isAgentClientFrame,
} from './agent-session-frames';
import { chartWithLayout } from './agent-session-tools';

const UI_APPLIED_TIMEOUT_MS = 15_000;

export interface EngineFacadeOptions {
  /** The `@maelstrom-co/engine` instance. The facade uses it only as the Planner. */
  readonly planner: Engine;
  /** OpenAI key for the Agent Session loop. Without one, agent turns fail fast. */
  readonly apiKey?: string;
  /** Writes one frame to this connection. The transport redacts secrets. */
  readonly send: (wire: string) => void;
}

export type PlannerOutcome =
  | {
      readonly ok: true;
      readonly response: MaelstromResponse;
      readonly plannerMs: number;
    }
  | { readonly ok: false; readonly error: string; readonly plannerMs: number };

/** The browser's answer to one `agent.ui`. */
export interface UiApplied {
  readonly uiId: string;
  readonly error?: string;
  readonly timedOut: boolean;
  /** The chart after the change, or the last known chart on a timeout. */
  readonly chart: AgentChartSnapshot | null;
  readonly ackMs: number;
}

type TimingValue = string | number | boolean | null | undefined;

export class EngineFacade {
  readonly planner: Engine;
  readonly #apiKey: string | undefined;
  readonly #send: (wire: string) => void;
  readonly #connectionId = crypto.randomUUID().slice(0, 8);
  readonly #pendingUiApplied = new Map<
    string,
    (frame: AgentUiAppliedFrame) => void
  >();
  #session: AgentSession | null = null;
  #chart: AgentChartSnapshot | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #queued = 0;

  constructor(options: EngineFacadeOptions) {
    this.planner = options.planner;
    this.#apiKey = options.apiKey;
    this.#send = options.send;
  }

  /** The latest chart the browser reported, from any frame that carries one. */
  get chart(): AgentChartSnapshot | null {
    return this.#chart;
  }

  /**
   * Handles one engine-bound frame. Resolves once a browser chart_request
   * has been answered; Agent Session frames return at once and the session
   * emits its own events.
   */
  async handle(raw: unknown): Promise<void> {
    const text = String(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    if (isAgentClientFrame(parsed)) {
      this.#receiveAgentFrame(parsed);
      return;
    }
    await this.#receiveEnvelope(text);
  }

  /**
   * Runs `job` after every job queued before it. Jobs run one at a time, so
   * at most one Planner call is in flight per connection.
   */
  enqueue<T>(
    label: string,
    job: (queueWaitMs: number) => Promise<T>,
  ): Promise<T> {
    const enqueuedAt = performance.now();
    const ahead = this.#queued++;
    const run = this.#queue.then(async () => {
      const queueWaitMs = Math.round(performance.now() - enqueuedAt);
      this.timing('queue.start', { job: label, ahead, queueWaitMs });
      try {
        return await job(queueWaitMs);
      } finally {
        this.#queued--;
      }
    });
    this.#queue = run.catch((error: unknown) => {
      console.warn(
        `[engine-facade] ${label} failed:`,
        error instanceof Error ? error.message : error,
      );
    });
    return run;
  }

  /** Resolves with the chart once the queue is empty, including jobs queued meanwhile. */
  async idle(): Promise<AgentChartSnapshot | null> {
    let current: Promise<unknown>;
    do {
      current = this.#queue;
      await current;
    } while (current !== this.#queue);
    return this.#chart;
  }

  /** Runs one Planner call against `chart`. Call it only from a queue job. */
  async callPlanner(
    intent: PlannerIntent,
    chart: AgentChartSnapshot,
    context: {
      readonly queueWaitMs: number;
      readonly turn?: number;
      /** Set for a browser chart_request: answer under its id with its reasons. */
      readonly envelope?: {
        readonly id: MessageId;
        readonly updateReasons: readonly UpdateReason[];
      };
    },
  ): Promise<PlannerOutcome> {
    const started = performance.now();
    const finish = (outcome: PlannerOutcome): PlannerOutcome => {
      this.timing('planner', {
        turn: context.turn,
        origin: intent.origin,
        queueWaitMs: context.queueWaitMs,
        plannerMs: outcome.plannerMs,
        ok: outcome.ok,
        required: intent.requiredActions.length || undefined,
      });
      return outcome;
    };
    const parsed = ChartRequestSchema.safeParse({
      type: 'chart_request',
      context: {
        updateReasons: context.envelope?.updateReasons ?? [
          { type: 'user_intent', intent: plannerIntentText(intent) },
        ],
        chartDimensions: chart.chartDimensions,
        layoutMode: chart.layoutMode,
      },
      instances: chart.instances,
      vessels: chart.vessels,
      layout: chart.layout,
    });
    if (!parsed.success)
      return finish({
        ok: false,
        error: `Chart snapshot rejected: ${parsed.error.message}`,
        plannerMs: 0,
      });
    const message = ChartRequestMessage({
      sessionId: SessionId(chart.sessionId),
      request: parsed.data as Parameters<
        typeof ChartRequestMessage
      >[0]['request'],
      ...(context.envelope ? { id: context.envelope.id } : {}),
    });
    const unregister = registerPlannerIntent(message.id, intent);
    try {
      const result = await this.planner.handle(message);
      const plannerMs = Math.round(performance.now() - started);
      if (isErr(result))
        return finish({ ok: false, error: result.error.message, plannerMs });
      if (result.value.type !== 'chart_response')
        return finish({
          ok: false,
          error: `Unexpected engine output ${result.value.type}`,
          plannerMs,
        });
      return finish({ ok: true, response: result.value.response, plannerMs });
    } finally {
      unregister();
    }
  }

  /** Sends one `agent.ui` and resolves once the browser acked it, or on a timeout. */
  pushUi(change: Omit<AgentUiFrame, 'type' | 'uiId'>): Promise<UiApplied> {
    const uiId = crypto.randomUUID();
    const pushedAt = performance.now();
    const ackMs = () => Math.round(performance.now() - pushedAt);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingUiApplied.delete(uiId);
        resolve({ uiId, timedOut: true, chart: this.#chart, ackMs: ackMs() });
      }, UI_APPLIED_TIMEOUT_MS);
      this.#pendingUiApplied.set(uiId, (frame) => {
        clearTimeout(timer);
        resolve({
          uiId,
          timedOut: false,
          chart: frame.chart,
          ackMs: ackMs(),
          ...(frame.error ? { error: frame.error } : {}),
        });
      });
      this.emit({ type: 'agent.ui', uiId, ...change });
    });
  }

  /** Writes one Agent Session event to the browser. */
  emit(frame: AgentServerFrame): void {
    this.#send(JSON.stringify(frame));
  }

  /** Logs one greppable `[timing]` line: `[timing] conn=<id> <event> key=value…`. */
  timing(event: string, fields: Record<string, TimingValue> = {}): void {
    const pairs = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) =>
        typeof value === 'string' && /[\s"=]/.test(value)
          ? `${key}=${JSON.stringify(value)}`
          : `${key}=${value}`,
      );
    console.log(
      `[timing] conn=${this.#connectionId} ${event}${pairs.length ? ` ${pairs.join(' ')}` : ''}`,
    );
  }

  #receiveAgentFrame(frame: AgentClientFrame): void {
    switch (frame.type) {
      case 'agent.input': {
        this.#chart = frame.chart;
        const session = this.#agentSession();
        if (session) {
          session.startTurn(frame);
          return;
        }
        this.emit({
          type: 'agent.done',
          turnId: frame.turnId,
          ok: false,
          reply: 'The shop assistant has no OpenAI key on this connection.',
          error: 'No OpenAI key for the Agent Session',
          metrics: null,
        });
        return;
      }
      case 'agent.tool.result':
        this.#session?.receiveToolResult(frame);
        return;
      case 'agent.ui.applied': {
        this.#chart = frame.chart;
        const resolve = this.#pendingUiApplied.get(frame.uiId);
        this.#pendingUiApplied.delete(frame.uiId);
        resolve?.(frame);
        return;
      }
    }
  }

  async #receiveEnvelope(text: string): Promise<void> {
    const decoded = decodeClientEnvelope(text);
    if (isErr(decoded)) {
      this.#emitEnvelope(
        EngineErrorMessage({
          error: decoded.error.message,
          code: decoded.error.kind,
          ...recoverCorrelation(text),
        }),
      );
      return;
    }
    const envelope = decoded.value;
    switch (envelope.type) {
      case 'chart_request':
        await this.#browserChartRequest(envelope);
        return;
      // The Agent Session transcript is the only history: voice and other
      // assistant notes land there instead of in an Engine history store.
      case 'assistant_message':
        this.#session?.addTranscriptNote(envelope.content, 'assistant');
        return;
      case 'client.assistant_message.acknowledged':
        this.#session?.addTranscriptNote(envelope.content, 'assistant');
        this.#emitEnvelope(
          AssistantMessageResultMessage({
            requestId: envelope.id,
            sessionId: envelope.sessionId,
            outcome: 'inserted',
          }),
        );
        return;
      case 'client.history.get':
        this.#emitEnvelope(
          HistoryResponseMessage({ requestId: envelope.id, entries: [] }),
        );
        return;
    }
  }

  // Resize and Vessel mutations skip the router and the loop, but share the
  // Planner queue so the Agent Session stays the only writer to the Chart.
  async #browserChartRequest(envelope: ChartRequestMessage): Promise<void> {
    const arrivedAt = performance.now();
    const { request } = envelope;
    // The request carries the browser's state at send time, newer than any
    // ack received before it; acks arriving while it waits are newer still.
    this.#chart = {
      sessionId: envelope.sessionId,
      chartDimensions: request.context.chartDimensions,
      layoutMode: request.context.layoutMode,
      instances: request.instances,
      vessels: request.vessels,
      layout: request.layout,
    };
    const reasons = request.context.updateReasons;
    const origin: PlannerCallOrigin = reasons.some(
      (reason) => reason.type === 'user_intent',
    )
      ? 'user_intent'
      : reasons.every((reason) => reason.type === 'chart_resize')
        ? 'chart_resize'
        : 'vessel_mutation';

    await this.enqueue(origin, async (queueWaitMs) => {
      const chart = this.#chart;
      if (!chart) return;
      const outcome = await this.callPlanner(
        {
          origin,
          intent: describeReasons(reasons),
          metadata: {},
          requiredActions: [],
        },
        { ...chart, sessionId: envelope.sessionId },
        { queueWaitMs, envelope: { id: envelope.id, updateReasons: reasons } },
      );
      if (!outcome.ok) {
        this.#emitEnvelope(
          EngineErrorMessage({
            requestId: envelope.id,
            sessionId: envelope.sessionId,
            error: outcome.error,
          }),
        );
        this.timing('envelope.reply', {
          origin,
          ok: false,
          sinceRequestMs: Math.round(performance.now() - arrivedAt),
        });
        return;
      }
      this.#emitEnvelope(
        MaelstromResponseMessage({
          requestId: envelope.id,
          sessionId: envelope.sessionId,
          response: outcome.response,
        }),
      );
      // No ack comes back for an envelope reply; assume the browser applied it.
      this.#chart = chartWithLayout(chart, outcome.response.layout);
      this.timing('envelope.reply', {
        origin,
        ok: true,
        sinceRequestMs: Math.round(performance.now() - arrivedAt),
      });
      this.#session?.noteScreen(
        origin,
        outcome.response.userMessage,
        this.#chart,
      );
    });
  }

  #agentSession(): AgentSession | null {
    if (!this.#apiKey) return null;
    this.#session ??= new AgentSession({ host: this, apiKey: this.#apiKey });
    return this.#session;
  }

  #emitEnvelope(envelope: ServerEnvelope): void {
    this.#send(encodeEnvelope(envelope));
  }
}

function describeReasons(reasons: readonly UpdateReason[]): string {
  return reasons
    .map((reason) => {
      if (reason.type === 'user_intent') return reason.intent;
      if (reason.type === 'chart_resize')
        return `Chart resized from ${reason.previous.columns}x${reason.previous.rows} to ${reason.current.columns}x${reason.current.rows}.`;
      return `Instance ${reason.instanceId} changed: ${reason.changes}`;
    })
    .join('\n');
}
