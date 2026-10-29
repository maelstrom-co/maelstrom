import {
  AGENT_WIRE_VERSION,
  type AgentErrorEvent,
  type AgentEvent,
  type AgentUiAppliedInput,
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
} from '@maelstrom-co/protocol';
import type { EngineError } from '../errors.js';
import type { OrderedEmitter } from './ordered-emitter.js';
import {
  buildAcceptanceEvents,
  buildRunEnding,
  type RunFailure,
} from './run-events.js';

export interface UiPlanInput {
  readonly request: ChartRequest;
  readonly messageId: MessageId;
  readonly runId: RunId;
  readonly signal: AbortSignal;
}

export type UiChangePlanner = (
  input: UiPlanInput,
) => Promise<Result<MaelstromResponse, EngineError>>;

export type RunObserver = (
  runId: RunId,
  inputId: MessageId,
  kind: string,
  metadata: DiagnosticMetadata,
  readContent?: () => unknown,
) => void;

export interface RunSchedulerOptions {
  readonly plan: UiChangePlanner;
  readonly observe: RunObserver;
  readonly events: OrderedEmitter<AgentEvent>;
  readonly signal: AbortSignal;
  readonly clock: () => number;
  readonly acknowledgementTimeoutMs: number;
}

export interface RunScheduler {
  pendingRuns(): number;
  enqueue(input: AgentUtteranceInput): Promise<void>;
  acknowledge(input: AgentUiAppliedInput): void;
  close(): void;
}

interface UiRun {
  readonly input: AgentUtteranceInput;
  readonly runId: RunId;
  readonly started: number;
  readonly ready: Deferred;
}

// A finishing run keeps its slot so input sent from its final callbacks queues behind it.
type RunState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'planning' | 'finishing'; readonly run: UiRun }
  | {
      readonly phase: 'awaiting_ack';
      readonly run: UiRun;
      readonly event: AgentUiChangeEvent;
      readonly cancelTimeout: () => void;
    };

export function createRunScheduler({
  plan,
  observe,
  events,
  signal,
  clock,
  acknowledgementTimeoutMs,
}: RunSchedulerOptions): RunScheduler {
  const queue: UiRun[] = [];
  let state: RunState = { phase: 'idle' };
  let chart: ChartRequest | undefined;
  const complete = (run: UiRun, reply: string, failure?: RunFailure) => {
    if (signal.aborted) return;
    const ending = buildRunEnding(run, clock(), reply, failure);
    events.emit(...ending.events);
    observe(
      run.runId,
      run.input.inputId,
      'engine.agent.run.finished',
      ending.metadata,
    );
  };
  const startNextRun = () => {
    state = { phase: 'idle' };
    void pump();
  };
  const failPlanning = (run: UiRun, failure: RunFailure) => {
    state = { phase: 'finishing', run };
    complete(run, '', failure);
    run.ready.resolve();
    startNextRun();
  };
  const expire = (run: UiRun) => {
    state = { phase: 'finishing', run };
    chart = undefined;
    const abandoned = queue.splice(0);
    complete(run, '', {
      code: 'ui_ack_timeout',
      error: 'The UI acknowledgement did not arrive.',
    });
    for (const queued of abandoned) {
      complete(queued, '', {
        reason: 'cancelled',
        code: 'ui_ack_timeout',
        error: 'The preceding UI change was not acknowledged.',
      });
      queued.ready.resolve();
    }
    startNextRun();
  };
  const emitUiChange = (run: UiRun, response: MaelstromResponse) => {
    const event: AgentUiChangeEvent = {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
      changeId: ChangeId(crypto.randomUUID()),
      response,
    };
    const timeout = setTimeout(() => {
      if (state.phase === 'awaiting_ack' && state.event === event) expire(run);
    }, acknowledgementTimeoutMs);
    state = {
      phase: 'awaiting_ack',
      run,
      event,
      cancelTimeout: () => clearTimeout(timeout),
    };
    events.emit(event);
    observe(run.runId, run.input.inputId, 'engine.agent.ui_change.emitted', {
      changeId: event.changeId,
      actions: response.executionPlan.length,
    });
    run.ready.resolve();
    void pump();
  };
  const pump = async (): Promise<void> => {
    if (signal.aborted || events.isDelivering() || state.phase !== 'idle')
      return;
    const run = queue.shift();
    if (!run) return;
    state = { phase: 'planning', run };
    const request = planningRequest(chart ?? run.input.chart, run.input.text);
    let result: Result<MaelstromResponse, EngineError>;
    try {
      result = await plan({
        messageId: run.input.inputId,
        runId: run.runId,
        signal,
        request,
      });
    } catch {
      failPlanning(run, {
        code: 'internal_error',
        error: 'The UI request failed.',
      });
      return;
    }
    if (signal.aborted) return;
    if (isErr(result))
      failPlanning(run, {
        error: 'The UI request failed.',
        code: result.error._tag,
      });
    else emitUiChange(run, result.value);
  };
  return {
    pendingRuns: () => queue.length + (state.phase === 'idle' ? 0 : 1),
    enqueue(input) {
      const started = clock();
      const run: UiRun = {
        input,
        runId: RunId(crypto.randomUUID()),
        started,
        ready: deferred(),
      };
      // A Chart sent while a change awaits acknowledgement can predate it.
      if (state.phase !== 'awaiting_ack') chart = input.chart;
      queue.push(run);
      events.emit(...buildAcceptanceEvents(input.inputId, run.runId));
      observe(
        run.runId,
        input.inputId,
        'engine.agent.input.accepted',
        { source: input.source, disposition: 'ui_only' },
        () => ({ text: input.text }),
      );
      void pump();
      return run.ready.promise;
    },
    acknowledge(input) {
      if (
        state.phase !== 'awaiting_ack' ||
        state.event.changeId !== input.changeId
      ) {
        events.emit(
          changeError(input.changeId, 'unknown_change', 'Unknown UI change.'),
        );
        return;
      }
      const { run, event, cancelTimeout } = state;
      if (input.actionOutcomes.length !== event.response.executionPlan.length) {
        events.emit(
          changeError(
            input.changeId,
            'invalid_action_outcomes',
            'Expected one outcome per Action.',
          ),
        );
        return;
      }
      state = { phase: 'finishing', run };
      cancelTimeout();
      chart = input.chart;
      observe(
        run.runId,
        run.input.inputId,
        'engine.agent.ui_change.applied',
        {
          changeId: input.changeId,
          actions: input.actionOutcomes.length,
          failed: input.actionOutcomes.filter((outcome) => !outcome.ok).length,
        },
        () => ({ chart: input.chart, actionOutcomes: input.actionOutcomes }),
      );
      complete(
        run,
        event.response.userMessage,
        input.actionOutcomes.some((outcome) => !outcome.ok)
          ? {
              code: 'ui_apply_failed',
              error: 'The UI change could not be fully applied.',
            }
          : undefined,
      );
      startNextRun();
    },
    close() {
      if (state.phase === 'awaiting_ack') state.cancelTimeout();
      if (state.phase !== 'idle') state.run.ready.resolve();
      state = { phase: 'idle' };
      for (const run of queue) run.ready.resolve();
      queue.length = 0;
      chart = undefined;
    },
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function planningRequest(chart: ChartRequest, intent: string): ChartRequest {
  const { skipReply: _skipReply, ...snapshot } = chart;
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      updateReasons: [{ type: 'user_intent', intent }],
    },
  };
}

function changeError(
  changeId: ChangeId,
  code: string,
  error: string,
): AgentErrorEvent {
  return { type: 'error', version: AGENT_WIRE_VERSION, changeId, code, error };
}
