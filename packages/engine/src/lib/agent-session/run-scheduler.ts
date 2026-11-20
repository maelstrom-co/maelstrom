import {
  AGENT_WIRE_VERSION,
  type AgentErrorEvent,
  type AgentEvent,
  type AgentUiAppliedInput,
  type AgentUiChangeEvent,
  type AgentUtteranceInput,
  ChangeId,
  type ChartRequest,
  isErr,
  type MaelstromResponse,
  type Result,
  RunId,
} from '@maelstrom-co/protocol';

import type { EngineError } from '../errors.js';
import type { Logger } from '../logger.js';
import {
  type DiagnosticObservers,
  observeUiChangeEmitted,
} from './agent-diagnostics.js';
import type { OrderedEmitter } from './ordered-emitter.js';
import {
  buildAcceptanceEvents,
  buildRunEnding,
  type RunFailure,
} from './run-events.js';
import { userIntentRequest } from './screen-change-request.js';
import { requireResponse, type SessionPlanner } from './session-planner.js';

export interface RunSchedulerOptions {
  readonly planner: SessionPlanner;
  readonly diagnostics: DiagnosticObservers;
  readonly logger: Logger;
  readonly events: OrderedEmitter<AgentEvent>;
  readonly signal: AbortSignal;
  readonly clock: () => number;
  readonly acknowledgementTimeoutMs: number;
}

export interface RunScheduler {
  pendingRuns(): number;
  reject(event: AgentErrorEvent): void;
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
  planner,
  diagnostics,
  logger,
  events,
  signal,
  clock,
  acknowledgementTimeoutMs,
}: RunSchedulerOptions): RunScheduler {
  const queue: UiRun[] = [];
  let state: RunState = { phase: 'idle' };
  let chart: ChartRequest | undefined;
  return {
    pendingRuns: () => queue.length + (state.phase === 'idle' ? 0 : 1),
    reject,
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
      diagnostics.run(
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
        refuseUnknownChange(input.changeId);
        return;
      }
      const { run, event, cancelTimeout } = state;
      if (input.actionOutcomes.length !== event.response.executionPlan.length) {
        diagnostics.run(
          run.runId,
          run.input.inputId,
          'engine.agent.ui_applied.rejected',
          {
            changeId: input.changeId,
            code: 'invalid_action_outcomes',
          },
        );
        reject(
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
      diagnostics.run(
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

  function complete(run: UiRun, reply?: string, failure?: RunFailure) {
    if (signal.aborted) return;
    const ending = buildRunEnding(run, clock(), reply, failure);
    events.emit(...ending.events);
    diagnostics.run(
      run.runId,
      run.input.inputId,
      'engine.agent.run.finished',
      ending.metadata,
    );
  }

  function startNextRun() {
    state = { phase: 'idle' };
    void pump();
  }

  function failPlanning(run: UiRun, failure: RunFailure) {
    state = { phase: 'finishing', run };
    complete(run, undefined, failure);
    run.ready.resolve();
    startNextRun();
  }

  function expire(run: UiRun) {
    state = { phase: 'finishing', run };
    chart = undefined;
    const abandoned = queue.splice(0);
    complete(run, undefined, {
      code: 'ui_ack_timeout',
      error: 'The UI acknowledgement did not arrive.',
    });
    for (const queued of abandoned) {
      complete(queued, undefined, {
        reason: 'cancelled',
        code: 'ui_ack_timeout',
        error: 'The preceding UI change was not acknowledged.',
      });
      queued.ready.resolve();
    }
    startNextRun();
  }

  function emitUiChange(run: UiRun, response: MaelstromResponse) {
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
    observeUiChangeEmitted(
      event,
      run.input.inputId,
      diagnostics,
      { changeId: event.changeId, actions: response.executionPlan.length },
      () => ({ response }),
    );
    run.ready.resolve();
    void pump();
  }

  async function pump(): Promise<void> {
    if (signal.aborted || events.isDelivering() || state.phase !== 'idle')
      return;
    const run = queue.shift();
    if (!run) return;
    state = { phase: 'planning', run };
    diagnostics.run(run.runId, run.input.inputId, 'engine.agent.run.started', {
      disposition: 'ui_only',
    });
    const request = userIntentRequest(chart ?? run.input.chart, run.input.text);
    const messageId = run.input.inputId;
    let result: Result<MaelstromResponse, EngineError>;
    try {
      const planned = await planner({
        messageId,
        owner: { runId: run.runId, inputId: messageId },
        signal,
        request,
      });
      result = isErr(planned)
        ? planned
        : requireResponse(planned.value, messageId, logger);
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
  }

  function reject(event: AgentErrorEvent): void {
    events.emit(event);
    void pump();
  }

  function refuseUnknownChange(changeId: ChangeId) {
    diagnostics.session('engine.agent.ui_applied.rejected', {
      changeId,
      code: 'unknown_change',
    });
    reject(changeError(changeId, 'unknown_change', 'Unknown UI change.'));
  }
}

/** Builds the agent `error` event that refuses a `ui_applied` input. */
export function changeError(
  changeId: ChangeId,
  code: string,
  error: string,
): AgentErrorEvent {
  return { type: 'error', version: AGENT_WIRE_VERSION, changeId, code, error };
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
