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
import {
  describeScreenUpdate,
  describeShowCancelled,
  describeShowFailed,
  describeShowNotConfirmed,
  describeShowSkipped,
  type ShowSkipReason,
} from './screen-note.js';
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
  /**
   * Aborted when the planning timeout passes, the run that asked for the
   * show is dropped, or the queue closes.
   */
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

/** How long a show's Planner call may run before the show fails with `planning_timeout`. */
export const SHOW_PLANNING_TIMEOUT_MS = 30_000;

/** Everything a {@link PlannerShowQueue} needs. */
export interface PlannerShowQueueOptions {
  /** Plans each show. */
  readonly planShow: ShowPlanner;
  /** The connection's ordered event stream. */
  readonly events: OrderedEmitter<AgentEvent>;
  /** Receives diagnostic observations of each show and change. */
  readonly observe: RunObserver;
  /** Records a show note for the run and turn that asked for the show. */
  readonly recordShowNote: (runId: RunId, turnId: string, text: string) => void;
  /** Receives warnings for shows dropped without a Chart and for failed shows. */
  readonly logger: Logger;
  /** Schedules a callback and returns a function that cancels it. */
  readonly scheduleTimeout: AgentRunClock['scheduleTimeout'];
  /** How long an emitted change may await its acknowledgement before the next show starts. */
  readonly acknowledgementTimeoutMs: number;
  /**
   * How long a show's Planner call may run before the show fails. Defaults to
   * {@link SHOW_PLANNING_TIMEOUT_MS}. Only tests override it.
   */
  readonly planningTimeoutMs?: number;
}

/**
 * Loop-driven shows of one connection, planned one at a time in arrival
 * order. A show holds the queue from planning until the browser acknowledges
 * its change, and each show plans on the latest acknowledged Chart. A show in
 * planning restarts when an utterance brings a Chart that changes its request.
 * Nothing here blocks the agent loop.
 *
 * A show's outcome reaches the transcript of the run that asked for it as one
 * note: a screen note after its acknowledgement, or a failed, skipped, not
 * confirmed or cancelled note. A Planner failure and an acknowledgement timeout also
 * send an agent `error` event carrying the show's `changeId` and `runId`.
 */
export interface PlannerShowQueue {
  /** Queues a show and starts it at once when nothing is planning or awaiting acknowledgement. */
  request(show: LoopDrivenShow): void;
  /**
   * Takes an utterance's Chart as the latest unless a change awaits
   * acknowledgement. A show in planning whose request the Chart changes is
   * planned again on it.
   */
  noteChart(chart: ChartRequest): void;
  /**
   * Settles the change awaiting acknowledgement. An unknown `changeId` or a
   * wrong outcome count is refused with an agent `error` event and leaves
   * the change pending.
   */
  acknowledge(input: AgentUiAppliedInput): void;
  /**
   * Resolves once no show is queued, planning or awaiting acknowledgement, at
   * once when the queue is already idle or closed.
   */
  whenIdle(): Promise<void>;
  /**
   * Drops the run's queued shows and aborts its show in planning, recording a
   * cancelled note for each and sending nothing on the wire. A change of that
   * run already emitted still awaits its acknowledgement and gets its note.
   */
  dropRun(runId: RunId): void;
  /**
   * Drops queued shows, aborts the show Planner call in flight and cancels
   * pending timers. Nothing reaches the wire or the transcript afterwards.
   */
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
  planningTimeoutMs = SHOW_PLANNING_TIMEOUT_MS,
}: PlannerShowQueueOptions): PlannerShowQueue {
  const queue: LoopDrivenShow[] = [];
  const idleWaiters: (() => void)[] = [];
  let state: ShowQueueState = { phase: 'idle' };
  let chart: ChartRequest | undefined;
  let closed = false;

  const resolveIdleWaiters = () => {
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const startNextShow = () => {
    state = { phase: 'idle' };
    pump();
    if (state.phase === 'idle') resolveIdleWaiters();
  };

  const abortPlanning = (job: ShowJob) => {
    job.cancelPlanningTimeout();
    job.controller.abort();
  };

  const noteFor = (show: LoopDrivenShow, text: string) =>
    recordShowNote(show.runId, show.turnId, text);

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
        expireChange(job);
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

  const expireChange = (job: ShowJob) => {
    const { show, changeId } = job;
    // Leave awaiting acknowledgement first so a late ui_applied is refused as unknown.
    state = { phase: 'idle' };
    events.emit({
      ...changeError(changeId, 'ui_ack_timeout', ACKNOWLEDGEMENT_TIMEOUT_TEXT),
      runId: show.runId,
    });
    noteFor(show, describeShowNotConfirmed(show.toolNames));
    observe(show.runId, show.inputId, 'engine.agent.ui_change.timed_out', {
      changeId,
      turnId: show.turnId,
    });
    startNextShow();
  };

  const failShow = (
    job: ShowJob,
    code: string,
    logContext?: ShowFailureLogContext,
  ) => {
    const { show, changeId } = job;
    state = { phase: 'idle' };
    // Never the Planner error message: it may carry model text.
    logger.warn('Loop-driven show failed', {
      changeId,
      messageId: job.messageId,
      runId: show.runId,
      turnId: show.turnId,
      toolNames: show.toolNames,
      code,
      ...logContext,
    });
    events.emit({
      ...changeError(changeId, code, PLANNER_FAILURE_TEXT),
      runId: show.runId,
    });
    noteFor(show, describeShowFailed(show.toolNames));
    observe(show.runId, show.inputId, 'engine.agent.show.failed', {
      changeId,
      turnId: show.turnId,
      code,
    });
    startNextShow();
  };

  const skipShow = (job: ShowJob, skip: ShowSkipReason) => {
    const { show, changeId } = job;
    state = { phase: 'idle' };
    noteFor(show, describeShowSkipped(show.toolNames, skip));
    observe(show.runId, show.inputId, 'engine.agent.show.skipped', {
      changeId,
      turnId: show.turnId,
      reason: skip.reason,
    });
    startNextShow();
  };

  const settle = (job: ShowJob, settled: PlanSettlement) => {
    if (closed || state.phase !== 'planning' || state.job !== job) return;
    job.cancelPlanningTimeout();
    if (settled.type === 'threw') {
      failShow(job, 'internal_error', { errorName: settled.errorName });
      return;
    }
    const { result } = settled;
    if (isErr(result)) {
      failShow(job, result.error._tag);
      return;
    }
    const outcome = result.value;
    switch (outcome.type) {
      case 'needs_clarification':
        skipShow(job, {
          reason: 'needs_clarification',
          question: outcome.question,
        });
        return;
      case 'response':
        if (isNothingToShow(outcome.response, job.request))
          skipShow(job, { reason: 'nothing_to_show' });
        else emitChange(job, outcome.response);
        return;
      default:
        assertNever(outcome, 'LoopDrivenPlanOutcome');
    }
  };

  const plan = async (job: ShowJob) => {
    let settled: PlanSettlement;
    try {
      const result = await planShow({
        request: job.request,
        messageId: job.messageId,
        runId: job.show.runId,
        inputId: job.show.inputId,
        turnId: job.show.turnId,
        signal: job.controller.signal,
      });
      settled = { type: 'returned', result };
    } catch (error) {
      // Only the error's name: its message may carry model text.
      settled = {
        type: 'threw',
        errorName: error instanceof Error ? error.name : typeof error,
      };
    }
    settle(job, settled);
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
      const controller = new AbortController();
      const job: ShowJob = {
        show,
        changeId: ChangeId(crypto.randomUUID()),
        messageId: MessageId(crypto.randomUUID()),
        request: buildShowRequest(chart, show.intent, show.intentFacts),
        controller,
        cancelPlanningTimeout: scheduleTimeout(() => {
          if (state.phase !== 'planning' || state.job !== job) return;
          controller.abort();
          failShow(job, 'planning_timeout');
        }, planningTimeoutMs),
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
      if (state.phase !== 'planning') return;
      const { job } = state;
      const request = buildShowRequest(
        next,
        job.show.intent,
        job.show.intentFacts,
      );
      if (isStructurallyEqual(request, job.request)) return;
      // The show in planning was built on a Chart this one supersedes: plan it again.
      job.controller.abort();
      queue.unshift(job.show);
      state = { phase: 'idle' };
      pump();
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
      noteFor(job.show, screenNote);
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
    whenIdle() {
      if (closed || (state.phase === 'idle' && queue.length === 0))
        return Promise.resolve();
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    dropRun(runId) {
      if (closed) return;
      const dropped = queue.filter((show) => show.runId === runId);
      const kept = queue.filter((show) => show.runId !== runId);
      queue.splice(0, queue.length, ...kept);
      const planning =
        state.phase === 'planning' && state.job.show.runId === runId
          ? state.job
          : undefined;
      if (planning !== undefined) {
        abortPlanning(planning);
        state = { phase: 'idle' };
        noteFor(planning.show, describeShowCancelled(planning.show.toolNames));
      }
      for (const show of dropped)
        noteFor(show, describeShowCancelled(show.toolNames));
      if (state.phase === 'idle') startNextShow();
    },
    close() {
      closed = true;
      queue.length = 0;
      if (state.phase === 'planning') abortPlanning(state.job);
      if (state.phase === 'awaiting_ack') state.cancelTimeout();
      state = { phase: 'idle' };
      resolveIdleWaiters();
    },
  };
}

const PLANNER_FAILURE_TEXT = 'The screen could not be updated.';
const ACKNOWLEDGEMENT_TIMEOUT_TEXT = 'The UI acknowledgement did not arrive.';

interface ShowJob {
  readonly show: LoopDrivenShow;
  readonly changeId: ChangeId;
  readonly messageId: MessageId;
  readonly request: ChartRequest;
  readonly controller: AbortController;
  readonly cancelPlanningTimeout: () => void;
}

/** Extra warning context for a failed show, beyond its ids and code. */
interface ShowFailureLogContext {
  /** Name or type of the error a thrown Planner call raised. */
  readonly errorName: string;
}

type PlanSettlement =
  | {
      readonly type: 'returned';
      readonly result: Result<LoopDrivenPlanOutcome, EngineError>;
    }
  | { readonly type: 'threw'; readonly errorName: string };

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
