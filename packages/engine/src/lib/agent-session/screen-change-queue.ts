import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentUiAppliedInput,
  type AgentUiChangeEvent,
  ChangeId,
  type ChartRequest,
  isErr,
  type MaelstromResponse,
  MessageId,
  type Result,
  type RunId,
} from '@maelstrom-co/protocol';

import { assertNever } from '../assert-never.js';
import type { EngineError } from '../errors.js';
import type { Logger } from '../logger.js';
import {
  type DiagnosticObservers,
  observeUiChangeEmitted,
} from './agent-diagnostics.js';
import type { AgentRunClock } from './agent-run.js';
import type { OrderedEmitter } from './ordered-emitter.js';
import { changeError } from './run-scheduler.js';
import type { ScreenChangeBatchGoal } from './screen-change-batch.js';
import { buildScreenChangeRequest } from './screen-change-request.js';
import {
  describeScreenChangeResult,
  type ScreenChangeOutcome,
  type ScreenChangeResult,
} from './screen-change-result.js';
import { capScreenNote, describeLateScreenChange } from './screen-note.js';
import type { PlanOutcome, SessionPlanner } from './session-planner.js';

/** The `change_screen` goals of one model turn, planned as one Screen Change. */
export interface ScreenChangeJob {
  /** The Agent Run whose turn called `change_screen`. */
  readonly runId: RunId;
  /** The utterance that started that run. */
  readonly inputId: MessageId;
  /** The model turn whose `change_screen` calls the goals come from. */
  readonly turnId: string;
  /** The goals, in admission order, each with its call id and reason id. */
  readonly goals: readonly ScreenChangeBatchGoal[];
}

/** How long a Screen Change's Planner call may run before every goal fails with `planning_timeout`. */
export const SCREEN_CHANGE_PLANNING_TIMEOUT_MS = 30_000;

/** Everything a {@link ScreenChangeQueue} needs. */
export interface ScreenChangeQueueOptions {
  /**
   * Plans each Screen Change with a `skipReply: true` request. Any `userMessage` it
   * returns is dropped from the change. The call's signal aborts when the
   * planning timeout passes, the run that asked for the Screen Change is dropped, or
   * the queue closes.
   */
  readonly planner: SessionPlanner;
  /** The connection's ordered event stream. */
  readonly events: OrderedEmitter<AgentEvent>;
  /**
   * Receives diagnostic observations of each Screen Change and change, and those that
   * belong to no run, such as an acknowledgement for an unknown change.
   */
  readonly diagnostics: DiagnosticObservers;
  /**
   * Records a Screen Note for a goal whose outcome settled after its run
   * stopped waiting, under the run and turn that asked for it.
   */
  readonly recordScreenNote: (
    runId: RunId,
    turnId: string,
    text: string,
  ) => void;
  /** Receives warnings for Screen Changes dropped without a Chart and for failed Screen Changes. */
  readonly logger: Logger;
  /** Schedules a callback and returns a function that cancels it. */
  readonly scheduleTimeout: AgentRunClock['scheduleTimeout'];
  /**
   * How long an emitted change may await its acknowledgement. Its goals
   * then answer `unknown` and the next Screen Change starts.
   */
  readonly acknowledgementTimeoutMs: number;
  /**
   * How long a Screen Change's Planner call may run before the Screen Change fails. Defaults to
   * {@link SCREEN_CHANGE_PLANNING_TIMEOUT_MS}.
   */
  readonly planningTimeoutMs?: number;
}

/**
 * Screen Changes of one connection, planned one at a time in arrival order.
 * A Screen Change holds the queue from planning until the browser
 * acknowledges its change, and each one plans on the latest acknowledged
 * Chart. A Screen Change in planning restarts when an utterance brings a
 * Chart that changes its request.
 *
 * Every goal settles exactly once with a {@link ScreenChangeResult}: `applied`
 * when acknowledged or already on screen, `failed` when the Planner failed or
 * an Action failed, `unknown` when the acknowledgement timed out,
 * `needs_clarification` when the Planner asked a question, and `cancelled`
 * when the run was dropped before the change went out or the queue closed.
 * A Planner failure and an acknowledgement timeout also send an agent `error`
 * event carrying the Screen Change's `changeId` and `runId`. An outcome that
 * settles after its run stopped waiting becomes a Screen Note instead.
 */
export interface ScreenChangeQueue {
  /**
   * Queues one Screen Change for the goals and starts it at once when nothing
   * is planning or awaiting acknowledgement. Returns one answer per goal, in
   * order.
   */
  request(job: ScreenChangeJob): readonly Promise<ScreenChangeResult>[];
  /**
   * Takes an utterance's Chart as the latest unless a change awaits
   * acknowledgement. A Screen Change in planning whose request the Chart changes is
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
   * Resolves once no Screen Change is queued, planning or awaiting acknowledgement, at
   * once when the queue is already idle or closed.
   */
  whenIdle(): Promise<void>;
  /**
   * Marks the run as no longer waiting. Its queued Screen Changes are dropped
   * and its Screen Change in planning is aborted, each goal answering
   * `cancelled` and observing `engine.agent.screen_change.cancelled`, with
   * nothing sent on the wire. A change of that run already emitted still
   * awaits its acknowledgement, and its outcome becomes a Screen Note.
   */
  dropRun(runId: RunId): void;
  /**
   * Answers every unsettled goal `cancelled`, aborts the Planner call in
   * flight and cancels pending timers. Nothing reaches the wire or the
   * transcript afterwards.
   */
  close(): void;
}

/** Creates the {@link ScreenChangeQueue} of one connection. */
export function createScreenChangeQueue({
  planner,
  events,
  diagnostics,
  recordScreenNote,
  logger,
  scheduleTimeout,
  acknowledgementTimeoutMs,
  planningTimeoutMs = SCREEN_CHANGE_PLANNING_TIMEOUT_MS,
}: ScreenChangeQueueOptions): ScreenChangeQueue {
  const queue: QueuedScreenChange[] = [];
  const idleWaiters: (() => void)[] = [];
  const stoppedRuns = new Set<RunId>();
  let state: ScreenChangeQueueState = { phase: 'idle' };
  let chart: ChartRequest | undefined;
  let closed = false;

  return {
    request(job) {
      const answers = job.goals.map(() => deferredResult());
      const queued: QueuedScreenChange = { job, answers };
      if (closed) {
        settleEach(queued, () => ({ outcome: 'cancelled' }));
        return answers.map((answer) => answer.promise);
      }
      diagnostics.run(
        job.runId,
        job.inputId,
        'engine.agent.screen_change.requested',
        {
          turnId: job.turnId,
          goals: job.goals.length,
          reasonIds: job.goals.map((goal) => goal.reasonId).join(','),
          callIds: job.goals.map((goal) => goal.callId).join(','),
        },
        () => ({
          goals: job.goals.map(({ goal, referents }) =>
            referents === undefined ? { goal } : { goal, referents },
          ),
        }),
      );
      queue.push(queued);
      pump();
      return answers.map((answer) => answer.promise);
    },
    noteChart(next) {
      if (closed || state.phase === 'awaiting_ack') return;
      chart = next;
      if (state.phase !== 'planning') return;
      const { planned } = state;
      const request = buildScreenChangeRequest(next, planned.queued.job.goals);
      if (isStructurallyEqual(request, planned.request)) return;
      // The Screen Change in planning was built on a Chart this one supersedes: plan it again.
      abortPlanning(planned);
      queue.unshift(planned.queued);
      state = { phase: 'idle' };
      pump();
    },
    acknowledge(input) {
      if (closed) return;
      if (
        state.phase !== 'awaiting_ack' ||
        state.planned.changeId !== input.changeId
      ) {
        refuseUnknownChange(input.changeId);
        return;
      }
      const { planned, event, cancelTimeout } = state;
      const { job } = planned.queued;
      const { executionPlan } = event.response;
      if (input.actionOutcomes.length !== executionPlan.length) {
        diagnostics.run(
          job.runId,
          job.inputId,
          'engine.agent.ui_applied.rejected',
          {
            changeId: input.changeId,
            turnId: job.turnId,
            code: 'invalid_action_outcomes',
          },
        );
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
      state = { phase: 'idle' };
      chart = input.chart;
      const failed = input.actionOutcomes.filter((outcome) => !outcome.ok);
      diagnostics.run(
        job.runId,
        job.inputId,
        'engine.agent.ui_change.applied',
        {
          changeId: planned.changeId,
          turnId: job.turnId,
          actions: executionPlan.length,
          failed: failed.length,
        },
        () => ({
          chart: input.chart,
          actionOutcomes: input.actionOutcomes,
        }),
      );
      const outcome: ScreenChangeOutcome =
        failed.length === 0 ? 'applied' : 'partially_failed';
      settleEach(planned.queued, () => ({
        outcome,
        changeId: planned.changeId,
      }));
      startNextScreenChange();
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
      stoppedRuns.add(runId);
      const dropped = queue.filter((queued) => queued.job.runId === runId);
      const kept = queue.filter((queued) => queued.job.runId !== runId);
      queue.splice(0, queue.length, ...kept);
      const planning =
        state.phase === 'planning' && state.planned.queued.job.runId === runId
          ? state.planned
          : undefined;
      if (planning !== undefined) {
        abortPlanning(planning);
        state = { phase: 'idle' };
        cancel(planning.queued, planning.changeId);
      }
      for (const queued of dropped) cancel(queued, undefined);
      if (state.phase === 'idle') startNextScreenChange();
    },
    close() {
      closed = true;
      const unsettled = queue.splice(0);
      if (state.phase === 'planning') {
        abortPlanning(state.planned);
        unsettled.push(state.planned.queued);
      }
      if (state.phase === 'awaiting_ack') {
        state.cancelTimeout();
        unsettled.push(state.planned.queued);
      }
      state = { phase: 'idle' };
      for (const queued of unsettled) answerCancelled(queued);
      resolveIdleWaiters();
    },
  };

  function answerCancelled(queued: QueuedScreenChange) {
    for (const [index, goal] of queued.job.goals.entries())
      queued.answers[index]?.resolve(resultOf(goal, { outcome: 'cancelled' }));
  }

  function resolveIdleWaiters() {
    for (const resolve of idleWaiters.splice(0)) resolve();
  }

  // Callers leave their Screen Change first. A listener may already have started the next one.
  function startNextScreenChange() {
    pump();
    if (state.phase === 'idle') resolveIdleWaiters();
  }

  function cancel(queued: QueuedScreenChange, changeId: ChangeId | undefined) {
    const { job } = queued;
    diagnostics.run(
      job.runId,
      job.inputId,
      'engine.agent.screen_change.cancelled',
      {
        turnId: job.turnId,
        ...(changeId === undefined ? {} : { changeId }),
      },
    );
    // The run's calls are answered live, so a cancellation writes no note.
    settleEach(queued, () => ({ outcome: 'cancelled' }), { live: true });
  }

  /**
   * Settles every goal of a Screen Change once. When the run stopped waiting,
   * the outcome becomes a Screen Note, unless `live` says the run's calls
   * still receive it.
   */
  function settleEach(
    queued: QueuedScreenChange,
    settlementOf: (goal: ScreenChangeBatchGoal) => GoalSettlement,
    { live = false }: { readonly live?: boolean } = {},
  ) {
    const { job } = queued;
    for (const [index, goal] of job.goals.entries()) {
      const result = resultOf(goal, settlementOf(goal));
      queued.answers[index]?.resolve(result);
      if (closed) continue;
      diagnostics.run(
        job.runId,
        job.inputId,
        'engine.agent.screen_change.settled',
        {
          turnId: job.turnId,
          callId: goal.callId,
          reasonId: goal.reasonId,
          status: result.status,
          ...(result.changeId === undefined
            ? {}
            : { changeId: result.changeId }),
        },
      );
      if (!live && stoppedRuns.has(job.runId))
        recordScreenNote(
          job.runId,
          job.turnId,
          describeLateScreenChange(result.summary),
        );
    }
  }

  function refuseUnknownChange(changeId: ChangeId) {
    diagnostics.session('engine.agent.ui_applied.rejected', {
      changeId,
      code: 'unknown_change',
    });
    events.emit(changeError(changeId, 'unknown_change', 'Unknown UI change.'));
  }

  function abortPlanning(planned: PlannedScreenChange) {
    planned.cancelPlanningTimeout();
    planned.controller.abort();
  }

  function emitChange(planned: PlannedScreenChange, plan: MaelstromResponse) {
    const { userMessage: _reply, ...response } = plan;
    const { changeId } = planned;
    const { job } = planned.queued;
    const event: AgentUiChangeEvent = {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId: job.runId,
      changeId,
      response,
    };
    const cancelTimeout = scheduleTimeout(() => {
      if (state.phase === 'awaiting_ack' && state.event === event)
        expireChange(planned);
    }, acknowledgementTimeoutMs);
    // Enter awaiting acknowledgement before emitting: a listener may acknowledge synchronously.
    state = { phase: 'awaiting_ack', planned, event, cancelTimeout };
    observeUiChangeEmitted(
      event,
      job.inputId,
      diagnostics,
      {
        changeId,
        turnId: job.turnId,
        actions: response.executionPlan.length,
      },
      () => ({
        goals: job.goals.map((goal) => goal.goal),
        response: event.response,
      }),
    );
    events.emit(event);
  }

  function expireChange(planned: PlannedScreenChange) {
    const { changeId } = planned;
    const { job } = planned.queued;
    // Leave awaiting acknowledgement first so a late ui_applied is refused as unknown.
    state = { phase: 'idle' };
    events.emit({
      ...changeError(changeId, 'ui_ack_timeout', ACKNOWLEDGEMENT_TIMEOUT_TEXT),
      runId: job.runId,
    });
    // A listener may close the queue inside the error event.
    if (closed) {
      answerCancelled(planned.queued);
      return;
    }
    diagnostics.run(
      job.runId,
      job.inputId,
      'engine.agent.ui_change.timed_out',
      {
        changeId,
        turnId: job.turnId,
      },
    );
    settleEach(planned.queued, () => ({ outcome: 'unknown', changeId }));
    startNextScreenChange();
  }

  function failScreenChange(
    planned: PlannedScreenChange,
    code: string,
    logContext?: ScreenChangeFailureLogContext,
  ) {
    const { changeId } = planned;
    const { job } = planned.queued;
    state = { phase: 'idle' };
    // Never the Planner error message: it may carry model text.
    logger.warn('Screen Change failed', {
      changeId,
      messageId: planned.messageId,
      runId: job.runId,
      turnId: job.turnId,
      goals: job.goals.length,
      code,
      ...logContext,
    });
    events.emit({
      ...changeError(changeId, code, PLANNER_FAILURE_TEXT),
      runId: job.runId,
    });
    // A listener may close the queue inside the error event.
    if (closed) {
      answerCancelled(planned.queued);
      return;
    }
    diagnostics.run(
      job.runId,
      job.inputId,
      'engine.agent.screen_change.failed',
      {
        changeId,
        turnId: job.turnId,
        code,
      },
    );
    settleEach(planned.queued, () => ({ outcome: 'failed' }));
    startNextScreenChange();
  }

  function settle(planned: PlannedScreenChange, settled: PlanSettlement) {
    if (closed || state.phase !== 'planning' || state.planned !== planned)
      return;
    planned.cancelPlanningTimeout();
    if (settled.type === 'threw') {
      failScreenChange(planned, 'internal_error', {
        errorName: settled.errorName,
      });
      return;
    }
    const { result } = settled;
    if (isErr(result)) {
      failScreenChange(planned, result.error._tag);
      return;
    }
    const outcome = result.value;
    switch (outcome.type) {
      case 'needs_clarification': {
        state = { phase: 'idle' };
        const question = capScreenNote(outcome.question);
        settleEach(planned.queued, () => ({
          outcome: 'needs_clarification',
          question,
        }));
        startNextScreenChange();
        return;
      }
      case 'response':
        if (isNoScreenChange(outcome.response, planned.request)) {
          state = { phase: 'idle' };
          settleEach(planned.queued, () => ({ outcome: 'already_on_screen' }));
          startNextScreenChange();
        } else emitChange(planned, outcome.response);
        return;
      default:
        assertNever(outcome, 'PlanOutcome');
    }
  }

  async function plan(planned: PlannedScreenChange) {
    const { job } = planned.queued;
    let settled: PlanSettlement;
    try {
      const result = await planner({
        request: planned.request,
        messageId: planned.messageId,
        owner: { runId: job.runId, inputId: job.inputId, turnId: job.turnId },
        signal: planned.controller.signal,
      });
      settled = { type: 'returned', result };
    } catch (error) {
      // Only the error's name: its message may carry model text.
      settled = {
        type: 'threw',
        errorName: error instanceof Error ? error.name : typeof error,
      };
    }
    settle(planned, settled);
  }

  function pump() {
    while (!closed && state.phase === 'idle') {
      const queued = queue.shift();
      if (queued === undefined) return;
      if (chart === undefined) {
        logger.warn('Dropped a Screen Change with no known Chart', {
          runId: queued.job.runId,
          turnId: queued.job.turnId,
        });
        settleEach(queued, () => ({ outcome: 'failed' }));
        continue;
      }
      const controller = new AbortController();
      const planned: PlannedScreenChange = {
        queued,
        changeId: ChangeId(crypto.randomUUID()),
        messageId: MessageId(crypto.randomUUID()),
        request: buildScreenChangeRequest(chart, queued.job.goals),
        controller,
        cancelPlanningTimeout: scheduleTimeout(() => {
          if (state.phase !== 'planning' || state.planned !== planned) return;
          controller.abort();
          failScreenChange(planned, 'planning_timeout');
        }, planningTimeoutMs),
      };
      state = { phase: 'planning', planned };
      void plan(planned);
    }
  }
}

const PLANNER_FAILURE_TEXT = 'The screen could not be updated.';
const ACKNOWLEDGEMENT_TIMEOUT_TEXT = 'The UI acknowledgement did not arrive.';

interface DeferredResult {
  readonly promise: Promise<ScreenChangeResult>;
  readonly resolve: (result: ScreenChangeResult) => void;
}

function deferredResult(): DeferredResult {
  let resolve!: (result: ScreenChangeResult) => void;
  let settled = false;
  const promise = new Promise<ScreenChangeResult>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    },
  };
}

/** How one goal settles, before its summary is written. */
interface GoalSettlement {
  readonly outcome: ScreenChangeOutcome;
  readonly changeId?: ChangeId;
  readonly question?: string;
  readonly options?: readonly string[];
  readonly onScreen?: readonly string[];
}

function resultOf(
  goal: ScreenChangeBatchGoal,
  { outcome, ...fields }: GoalSettlement,
): ScreenChangeResult {
  return {
    status: STATUS_OF[outcome],
    summary: describeScreenChangeResult(goal.goal, outcome),
    ...definedFields(fields),
  };
}

const STATUS_OF: Record<ScreenChangeOutcome, ScreenChangeResult['status']> = {
  applied: 'applied',
  already_on_screen: 'applied',
  failed: 'failed',
  partially_failed: 'failed',
  unknown: 'unknown',
  needs_clarification: 'needs_clarification',
  cancelled: 'cancelled',
};

function definedFields<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

interface QueuedScreenChange {
  readonly job: ScreenChangeJob;
  readonly answers: readonly DeferredResult[];
}

interface PlannedScreenChange {
  readonly queued: QueuedScreenChange;
  readonly changeId: ChangeId;
  readonly messageId: MessageId;
  readonly request: ChartRequest;
  readonly controller: AbortController;
  readonly cancelPlanningTimeout: () => void;
}

/** Extra warning context for a failed Screen Change, beyond its ids and code. */
interface ScreenChangeFailureLogContext {
  /** Name or type of the error a thrown Planner call raised. */
  readonly errorName: string;
}

type PlanSettlement =
  | {
      readonly type: 'returned';
      readonly result: Result<PlanOutcome, EngineError>;
    }
  | { readonly type: 'threw'; readonly errorName: string };

type ScreenChangeQueueState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'planning'; readonly planned: PlannedScreenChange }
  | {
      readonly phase: 'awaiting_ack';
      readonly planned: PlannedScreenChange;
      readonly event: AgentUiChangeEvent;
      readonly cancelTimeout: () => void;
    };

function isNoScreenChange(
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
