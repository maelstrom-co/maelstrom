import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentUiAppliedInput,
  type AgentUiChangeEvent,
  ChangeId,
  type ChartRequest,
  isErr,
  type JsonValue,
  type MaelstromResponse,
  MessageId,
  type Result,
  type RunId,
} from '@maelstrom-co/protocol';

import { assertNever } from '../assert-never.js';
import type { EngineError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { AgentRunClock } from './agent-run.js';
import type { OrderedEmitter } from './ordered-emitter.js';
import { changeError, type RunObserver } from './run-scheduler.js';
import { describeScreenUpdate } from './screen-note.js';
import { buildShowRequest } from './show-request.js';

/** One loop-driven Planner call, made for a show when its turn in the queue comes. */
export interface ShowPlanInput {
  /** The request built from the latest Chart, with `skipReply: true`. */
  readonly request: ChartRequest;
  /** Fresh message id of this Planner call, distinct from the run's input id. */
  readonly messageId: MessageId;
  /** The Agent Run whose tool phase asked for the show. */
  readonly runId: RunId;
  /** The utterance that started that run. */
  readonly inputId: MessageId;
  /** The model turn whose tool phase asked for the show. */
  readonly turnId: string;
  /** Aborted when the queue closes. */
  readonly signal: AbortSignal;
}

/** What a loop-driven Planner call settled on. */
export type LoopDrivenPlanOutcome =
  | {
      readonly type: 'response';
      /** The validated change, with any `userMessage` already removed. */
      readonly response: MaelstromResponse;
    }
  | {
      readonly type: 'needs_clarification';
      /** The question the Planner asked instead of planning a change. */
      readonly question: string;
    };

/** Plans one loop-driven show. The Engine builds it from its Planner. */
export type ShowPlanner = (
  input: ShowPlanInput,
) => Promise<Result<LoopDrivenPlanOutcome, EngineError>>;

/** A show a tool phase asks for. */
export interface LoopDrivenShow {
  /** The Agent Run whose tool phase asked for the show. */
  readonly runId: RunId;
  /** The utterance that started that run. */
  readonly inputId: MessageId;
  /** The model turn whose tool phase asked for the show. */
  readonly turnId: string;
  /** The user intent the show plans for, the run's utterance text. */
  readonly intent: string;
  /** Names of the tools whose successful results the show reflects, in call order. */
  readonly toolNames: readonly string[];
  /** Facts the tool phase produced for the Planner, keyed `<toolName>:<callId>`. */
  readonly intentFacts?: Readonly<Record<string, JsonValue>>;
}

/** Everything a {@link PlannerShowQueue} needs. */
export interface PlannerShowQueueOptions {
  /** Plans each show. */
  readonly planShow: ShowPlanner;
  /** The connection's ordered event stream. */
  readonly events: OrderedEmitter<AgentEvent>;
  /** Receives diagnostic observations of each change. */
  readonly observe: RunObserver;
  /** Records a screen note for the run and turn that asked for the show. */
  readonly recordShowNote: (runId: RunId, turnId: string, text: string) => void;
  /** Receives warnings for shows that end without a change. */
  readonly logger: Logger;
  /** Schedules a callback and returns a function that cancels it. */
  readonly scheduleTimeout: AgentRunClock['scheduleTimeout'];
  /** How long an emitted change may await its acknowledgement before the next show starts. */
  readonly acknowledgementTimeoutMs: number;
}

/**
 * Loop-driven shows of one connection, planned one at a time in arrival
 * order. A show holds the queue from planning until the browser acknowledges
 * its change, and each show plans on the latest acknowledged Chart. Nothing
 * here blocks the agent loop.
 */
export interface PlannerShowQueue {
  /** Queues a show and starts it at once when nothing is planning or awaiting acknowledgement. */
  request(show: LoopDrivenShow): void;
  /** Takes an utterance's Chart as the latest unless a change awaits acknowledgement. */
  noteChart(chart: ChartRequest): void;
  /**
   * Settles the change awaiting acknowledgement. An unknown `changeId` or a
   * wrong outcome count is refused with an agent `error` event and leaves
   * the change pending.
   */
  acknowledge(input: AgentUiAppliedInput): void;
  /** Drops queued shows, aborts the one in flight and emits nothing further. */
  close(): void;
}

/** Creates the {@link PlannerShowQueue} of one connection. */
export function createPlannerShowQueue({
  planShow,
  events,
  observe,
  recordShowNote,
  logger,
  scheduleTimeout,
  acknowledgementTimeoutMs,
}: PlannerShowQueueOptions): PlannerShowQueue {
  const queue: LoopDrivenShow[] = [];
  let state: ShowQueueState = { phase: 'idle' };
  let chart: ChartRequest | undefined;
  let closed = false;

  const startNextShow = () => {
    state = { phase: 'idle' };
    pump();
  };

  const emitChange = (job: ShowJob, planned: MaelstromResponse) => {
    const { userMessage: _reply, ...response } = planned;
    const { show, changeId } = job;
    const event: AgentUiChangeEvent = {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId: show.runId,
      changeId,
      response,
    };
    const cancelTimeout = scheduleTimeout(() => {
      if (state.phase === 'awaiting_ack' && state.event === event)
        startNextShow();
    }, acknowledgementTimeoutMs);
    // Enter awaiting acknowledgement before emitting: a listener may acknowledge synchronously.
    state = { phase: 'awaiting_ack', job, event, cancelTimeout };
    observe(
      show.runId,
      show.inputId,
      'engine.agent.ui_change.emitted',
      { changeId, turnId: show.turnId, actions: response.executionPlan.length },
      () => ({ intent: show.intent, intentFacts: show.intentFacts }),
    );
    events.emit(event);
  };

  const settle = (
    job: ShowJob,
    result: Result<LoopDrivenPlanOutcome, EngineError> | undefined,
  ) => {
    if (closed || state.phase !== 'planning' || state.job !== job) return;
    const context = {
      changeId: job.changeId,
      runId: job.show.runId,
      turnId: job.show.turnId,
      toolNames: job.show.toolNames,
    };
    if (result === undefined) {
      logger.warn('Loop-driven show planning threw', context);
    } else if (isErr(result)) {
      logger.warn('Loop-driven show planning failed', {
        ...context,
        code: result.error._tag,
      });
    } else {
      const outcome = result.value;
      switch (outcome.type) {
        case 'needs_clarification':
          logger.warn('Loop-driven show needs clarification', context);
          break;
        case 'response':
          if (!isNothingToShow(outcome.response, job.request)) {
            emitChange(job, outcome.response);
            return;
          }
          break;
        default:
          assertNever(outcome, 'LoopDrivenPlanOutcome');
      }
    }
    startNextShow();
  };

  const plan = async (job: ShowJob) => {
    let result: Result<LoopDrivenPlanOutcome, EngineError> | undefined;
    try {
      result = await planShow({
        request: job.request,
        messageId: MessageId(crypto.randomUUID()),
        runId: job.show.runId,
        inputId: job.show.inputId,
        turnId: job.show.turnId,
        signal: job.controller.signal,
      });
    } catch {
      result = undefined;
    }
    settle(job, result);
  };

  const pump = () => {
    while (!closed && state.phase === 'idle') {
      const show = queue.shift();
      if (show === undefined) return;
      if (chart === undefined) {
        logger.warn('Dropped a loop-driven show with no known Chart', {
          runId: show.runId,
          turnId: show.turnId,
        });
        continue;
      }
      const job: ShowJob = {
        show,
        changeId: ChangeId(crypto.randomUUID()),
        request: buildShowRequest(chart, show.intent, show.intentFacts),
        controller: new AbortController(),
      };
      state = { phase: 'planning', job };
      void plan(job);
    }
  };

  return {
    request(show) {
      if (closed) return;
      queue.push(show);
      pump();
    },
    noteChart(next) {
      if (closed || state.phase === 'awaiting_ack') return;
      chart = next;
    },
    acknowledge(input) {
      if (closed) return;
      if (
        state.phase !== 'awaiting_ack' ||
        state.job.changeId !== input.changeId
      ) {
        events.emit(
          changeError(input.changeId, 'unknown_change', 'Unknown UI change.'),
        );
        return;
      }
      const { job, event, cancelTimeout } = state;
      const { executionPlan } = event.response;
      if (input.actionOutcomes.length !== executionPlan.length) {
        events.emit(
          changeError(
            input.changeId,
            'invalid_action_outcomes',
            'Expected one outcome per Action.',
          ),
        );
        return;
      }
      cancelTimeout();
      chart = input.chart;
      const screenNote = describeScreenUpdate({
        executionPlan,
        actionOutcomes: input.actionOutcomes,
        chart: input.chart,
      });
      recordShowNote(job.show.runId, job.show.turnId, screenNote);
      observe(
        job.show.runId,
        job.show.inputId,
        'engine.agent.ui_change.applied',
        {
          changeId: job.changeId,
          turnId: job.show.turnId,
          actions: executionPlan.length,
          failed: input.actionOutcomes.filter((outcome) => !outcome.ok).length,
        },
        () => ({
          chart: input.chart,
          actionOutcomes: input.actionOutcomes,
          screenNote,
        }),
      );
      startNextShow();
    },
    close() {
      closed = true;
      queue.length = 0;
      if (state.phase === 'planning') state.job.controller.abort();
      if (state.phase === 'awaiting_ack') state.cancelTimeout();
      state = { phase: 'idle' };
    },
  };
}

interface ShowJob {
  readonly show: LoopDrivenShow;
  readonly changeId: ChangeId;
  readonly request: ChartRequest;
  readonly controller: AbortController;
}

type ShowQueueState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'planning'; readonly job: ShowJob }
  | {
      readonly phase: 'awaiting_ack';
      readonly job: ShowJob;
      readonly event: AgentUiChangeEvent;
      readonly cancelTimeout: () => void;
    };

function isNothingToShow(
  response: MaelstromResponse,
  request: ChartRequest,
): boolean {
  return (
    response.executionPlan.length === 0 &&
    isStructurallyEqual(response.layout, request.layout)
  );
}

function isStructurallyEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = definedKeys(leftRecord);
  const rightKeys = definedKeys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      isStructurallyEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function definedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => record[key] !== undefined);
}
