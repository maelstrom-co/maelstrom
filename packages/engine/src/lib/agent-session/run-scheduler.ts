import {
  AGENT_WIRE_VERSION,
  type AgentChartRequestInput,
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
  reject(event: AgentErrorEvent): void;
  enqueue(input: UiRunInput): Promise<void>;
  acknowledge(input: AgentUiAppliedInput): void;
  close(): void;
}

type UiRunInput = AgentUtteranceInput | AgentChartRequestInput;

interface UiRun {
  readonly input: UiRunInput;
  readonly runId: RunId;
  readonly started: number;
  readonly ready: Deferred;
}

// A finishing run keeps its slot so input sent from its final callbacks queues behind it.
type RunState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'stopped' }
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
  const stop = (run: UiRun, failure: RunFailure) => {
    state = { phase: 'stopped' };
    chart = undefined;
    const abandoned = queue.splice(0);
    complete(run, '', failure);
    run.ready.resolve();
    for (const queued of abandoned) {
      complete(queued, '', { ...failure, reason: 'cancelled' });
      queued.ready.resolve();
    }
  };
  const expire = (run: UiRun) => {
    stop(run, {
      code: 'ui_ack_timeout',
      error: 'The UI acknowledgement did not arrive.',
    });
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
    if (signal.aborted || state.phase !== 'idle') return;
    if (events.isDelivering()) {
      queueMicrotask(() => void pump());
      return;
    }
    const run = queue.shift();
    if (!run) return;
    state = { phase: 'planning', run };
    const request =
      run.input.type === 'chart_request'
        ? run.input.request
        : planningRequest(chart ?? run.input.chart, run.input.text);
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
  const reject = (event: AgentErrorEvent): void => {
    events.emit(event);
    void pump();
  };
  return {
    pendingRuns: () =>
      queue.length +
      (state.phase === 'idle' || state.phase === 'stopped' ? 0 : 1),
    reject,
    enqueue(input) {
      if (state.phase === 'stopped') {
        events.emit({
          type: 'error',
          version: AGENT_WIRE_VERSION,
          inputId: input.inputId,
          code: 'session_stopped',
          error: 'The preceding UI change has an unknown outcome.',
        });
        return Promise.resolve();
      }
      const started = clock();
      const run: UiRun = {
        input,
        runId: RunId(crypto.randomUUID()),
        started,
        ready: deferred(),
      };
      // A Chart sent while a change awaits acknowledgement can predate it.
      if (input.type === 'utterance' && state.phase !== 'awaiting_ack')
        chart = input.chart;
      queue.push(run);
      events.emit(...buildAcceptanceEvents(input.inputId, run.runId));
      observe(
        run.runId,
        input.inputId,
        'engine.agent.input.accepted',
        {
          source: input.type === 'utterance' ? input.source : 'chart_request',
          disposition: 'ui_only',
        },
        () =>
          input.type === 'utterance'
            ? { text: input.text }
            : { request: input.request },
      );
      void pump();
      return run.ready.promise;
    },
    acknowledge(input) {
      if (
        state.phase !== 'awaiting_ack' ||
        state.event.changeId !== input.changeId
      ) {
        reject(
          changeError(input.changeId, 'unknown_change', 'Unknown UI change.'),
        );
        return;
      }
      const { run, event, cancelTimeout } = state;
      const expectedActions = event.response.executionPlan.length;
      if (
        input.actionOutcomes.length > expectedActions ||
        (input.status === 'applied' &&
          input.actionOutcomes.length !== expectedActions)
      ) {
        reject(
          changeError(
            input.changeId,
            'invalid_action_outcomes',
            'Action evidence must fit the plan and be complete for applied status.',
          ),
        );
        return;
      }
      state =
        input.status === 'unknown'
          ? { phase: 'stopped' }
          : { phase: 'finishing', run };
      cancelTimeout();
      chart = input.status === 'unknown' ? undefined : input.chart;
      observe(
        run.runId,
        run.input.inputId,
        'engine.agent.ui_change.applied',
        {
          changeId: input.changeId,
          status: input.status,
          actions: input.actionOutcomes.length,
          failed: input.actionOutcomes.filter((outcome) => !outcome.ok).length,
        },
        () => ({ chart: input.chart, actionOutcomes: input.actionOutcomes }),
      );
      if (input.status === 'unknown') {
        stop(run, {
          code: 'ui_apply_unknown',
          error: 'The UI change has an unknown outcome.',
        });
        return;
      }
      complete(
        run,
        event.response.userMessage,
        input.status === 'failed'
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
      if (state.phase !== 'idle' && state.phase !== 'stopped')
        state.run.ready.resolve();
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
