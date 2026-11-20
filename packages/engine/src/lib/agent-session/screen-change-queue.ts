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
import { buildScreenChangeRequest } from './screen-change-request.js';
import {
  describeScreenUpdate,
  describeScreenChangeCancelled,
  describeScreenChangeFailed,
  describeScreenChangeNotConfirmed,
  describeScreenChangeSkipped,
  type ScreenChangeSkipReason,
} from './screen-note.js';
import type { PlanOutcome, SessionPlanner } from './session-planner.js';

/** A Screen Change a tool phase asks for. */
export interface ScreenChangeJob {
  /** The Agent Run whose tool phase asked for the Screen Change. */
  readonly runId: RunId;
  /** The utterance that started that run. */
  readonly inputId: MessageId;
  /** The model turn whose tool phase asked for the Screen Change. */
  readonly turnId: string;
  /** The user intent the Screen Change plans for, the run's utterance text. */
  readonly intent: string;
  /** Names of the tools whose successful results the Screen Change reflects, in call order. */
  readonly toolNames: readonly string[];
}

/** How long a Screen Change's Planner call may run before the Screen Change fails with `planning_timeout`. */
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
  /** Records a screen note for the run and turn that asked for the Screen Change. */
  readonly recordScreenNote: (
    runId: RunId,
    turnId: string,
    text: string,
  ) => void;
  /** Receives warnings for Screen Changes dropped without a Chart and for failed Screen Changes. */
  readonly logger: Logger;
  /** Schedules a callback and returns a function that cancels it. */
  readonly scheduleTimeout: AgentRunClock['scheduleTimeout'];
  /** How long an emitted change may await its acknowledgement before the next Screen Change starts. */
  readonly acknowledgementTimeoutMs: number;
  /**
   * How long a Screen Change's Planner call may run before the Screen Change fails. Defaults to
   * {@link SCREEN_CHANGE_PLANNING_TIMEOUT_MS}.
   */
  readonly planningTimeoutMs?: number;
}

/**
 * Screen Changes of one connection, planned one at a time in arrival
 * order. A Screen Change holds the queue from planning until the browser acknowledges
 * its change, and each Screen Change plans on the latest acknowledged Chart. A Screen Change in
 * planning restarts when an utterance brings a Chart that changes its request.
 * Nothing here blocks the agent loop.
 *
 * A Screen Change's outcome reaches the transcript of the run that asked for it as one
 * note: a screen note after its acknowledgement, or a failed, skipped, not
 * confirmed or cancelled note. A Planner failure and an acknowledgement timeout also
 * send an agent `error` event carrying the Screen Change's `changeId` and `runId`.
 */
export interface ScreenChangeQueue {
  /** Queues a Screen Change and starts it at once when nothing is planning or awaiting acknowledgement. */
  request(screenChange: ScreenChangeJob): void;
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
   * Drops the run's queued Screen Changes and aborts its Screen Change in planning, recording a
   * cancelled note and observing `engine.agent.screen_change.cancelled` for each, and
   * sending nothing on the wire. A change of that
   * run already emitted still awaits its acknowledgement and gets its note.
   */
  dropRun(runId: RunId): void;
  /**
   * Drops queued Screen Changes, aborts the Screen Change Planner call in flight and cancels
   * pending timers. Nothing reaches the wire or the transcript afterwards.
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
  const queue: ScreenChangeJob[] = [];
  const idleWaiters: (() => void)[] = [];
  let state: ScreenChangeQueueState = { phase: 'idle' };
  let chart: ChartRequest | undefined;
  let closed = false;

  return {
    request(screenChange) {
      if (closed) return;
      queue.push(screenChange);
      pump();
    },
    noteChart(next) {
      if (closed || state.phase === 'awaiting_ack') return;
      chart = next;
      if (state.phase !== 'planning') return;
      const { job } = state;
      const request = buildScreenChangeRequest(next, job.screenChange.intent);
      if (isStructurallyEqual(request, job.request)) return;
      // The Screen Change in planning was built on a Chart this one supersedes: plan it again.
      abortPlanning(job);
      queue.unshift(job.screenChange);
      state = { phase: 'idle' };
      pump();
    },
    acknowledge(input) {
      if (closed) return;
      if (
        state.phase !== 'awaiting_ack' ||
        state.job.changeId !== input.changeId
      ) {
        refuseUnknownChange(input.changeId);
        return;
      }
      const { job, event, cancelTimeout } = state;
      const { executionPlan } = event.response;
      if (input.actionOutcomes.length !== executionPlan.length) {
        diagnostics.run(
          job.screenChange.runId,
          job.screenChange.inputId,
          'engine.agent.ui_applied.rejected',
          {
            changeId: input.changeId,
            turnId: job.screenChange.turnId,
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
      const screenNote = describeScreenUpdate({
        executionPlan,
        actionOutcomes: input.actionOutcomes,
        chart: input.chart,
      });
      noteFor(job.screenChange, screenNote);
      diagnostics.run(
        job.screenChange.runId,
        job.screenChange.inputId,
        'engine.agent.ui_change.applied',
        {
          changeId: job.changeId,
          turnId: job.screenChange.turnId,
          actions: executionPlan.length,
          failed: input.actionOutcomes.filter((outcome) => !outcome.ok).length,
        },
        () => ({
          chart: input.chart,
          actionOutcomes: input.actionOutcomes,
          screenNote,
        }),
      );
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
      const dropped = queue.filter(
        (screenChange) => screenChange.runId === runId,
      );
      const kept = queue.filter((screenChange) => screenChange.runId !== runId);
      queue.splice(0, queue.length, ...kept);
      const planning =
        state.phase === 'planning' && state.job.screenChange.runId === runId
          ? state.job
          : undefined;
      if (planning !== undefined) {
        abortPlanning(planning);
        state = { phase: 'idle' };
        const { screenChange, changeId } = planning;
        noteFor(
          screenChange,
          describeScreenChangeCancelled(screenChange.toolNames),
        );
        diagnostics.run(
          screenChange.runId,
          screenChange.inputId,
          'engine.agent.screen_change.cancelled',
          {
            turnId: screenChange.turnId,
            changeId,
          },
        );
      }
      for (const screenChange of dropped) {
        noteFor(
          screenChange,
          describeScreenChangeCancelled(screenChange.toolNames),
        );
        diagnostics.run(
          screenChange.runId,
          screenChange.inputId,
          'engine.agent.screen_change.cancelled',
          {
            turnId: screenChange.turnId,
          },
        );
      }
      if (state.phase === 'idle') startNextScreenChange();
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

  function resolveIdleWaiters() {
    for (const resolve of idleWaiters.splice(0)) resolve();
  }

  // Callers leave their Screen Change first. A listener may already have started the next one.
  function startNextScreenChange() {
    pump();
    if (state.phase === 'idle') resolveIdleWaiters();
  }

  function refuseUnknownChange(changeId: ChangeId) {
    diagnostics.session('engine.agent.ui_applied.rejected', {
      changeId,
      code: 'unknown_change',
    });
    events.emit(changeError(changeId, 'unknown_change', 'Unknown UI change.'));
  }

  function abortPlanning(job: PlannedScreenChange) {
    job.cancelPlanningTimeout();
    job.controller.abort();
  }

  function noteFor(screenChange: ScreenChangeJob, text: string) {
    recordScreenNote(screenChange.runId, screenChange.turnId, text);
  }

  function emitChange(job: PlannedScreenChange, planned: MaelstromResponse) {
    const { userMessage: _reply, ...response } = planned;
    const { screenChange, changeId } = job;
    const event: AgentUiChangeEvent = {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId: screenChange.runId,
      changeId,
      response,
    };
    const cancelTimeout = scheduleTimeout(() => {
      if (state.phase === 'awaiting_ack' && state.event === event)
        expireChange(job);
    }, acknowledgementTimeoutMs);
    // Enter awaiting acknowledgement before emitting: a listener may acknowledge synchronously.
    state = { phase: 'awaiting_ack', job, event, cancelTimeout };
    observeUiChangeEmitted(
      event,
      screenChange.inputId,
      diagnostics,
      {
        changeId,
        turnId: screenChange.turnId,
        actions: response.executionPlan.length,
      },
      () => ({ intent: screenChange.intent, response: event.response }),
    );
    events.emit(event);
  }

  function expireChange(job: PlannedScreenChange) {
    const { screenChange, changeId } = job;
    // Leave awaiting acknowledgement first so a late ui_applied is refused as unknown.
    state = { phase: 'idle' };
    events.emit({
      ...changeError(changeId, 'ui_ack_timeout', ACKNOWLEDGEMENT_TIMEOUT_TEXT),
      runId: screenChange.runId,
    });
    if (closed) return;
    noteFor(
      screenChange,
      describeScreenChangeNotConfirmed(screenChange.toolNames),
    );
    diagnostics.run(
      screenChange.runId,
      screenChange.inputId,
      'engine.agent.ui_change.timed_out',
      {
        changeId,
        turnId: screenChange.turnId,
      },
    );
    startNextScreenChange();
  }

  function failScreenChange(
    job: PlannedScreenChange,
    code: string,
    logContext?: ScreenChangeFailureLogContext,
  ) {
    const { screenChange, changeId } = job;
    state = { phase: 'idle' };
    // Never the Planner error message: it may carry model text.
    logger.warn('Screen Change failed', {
      changeId,
      messageId: job.messageId,
      runId: screenChange.runId,
      turnId: screenChange.turnId,
      toolNames: screenChange.toolNames,
      code,
      ...logContext,
    });
    events.emit({
      ...changeError(changeId, code, PLANNER_FAILURE_TEXT),
      runId: screenChange.runId,
    });
    if (closed) return;
    noteFor(screenChange, describeScreenChangeFailed(screenChange.toolNames));
    diagnostics.run(
      screenChange.runId,
      screenChange.inputId,
      'engine.agent.screen_change.failed',
      {
        changeId,
        turnId: screenChange.turnId,
        code,
      },
    );
    startNextScreenChange();
  }

  function skipScreenChange(
    job: PlannedScreenChange,
    skip: ScreenChangeSkipReason,
  ) {
    const { screenChange, changeId } = job;
    state = { phase: 'idle' };
    noteFor(
      screenChange,
      describeScreenChangeSkipped(screenChange.toolNames, skip),
    );
    diagnostics.run(
      screenChange.runId,
      screenChange.inputId,
      'engine.agent.screen_change.skipped',
      {
        changeId,
        turnId: screenChange.turnId,
        reason: skip.reason,
      },
    );
    startNextScreenChange();
  }

  function settle(job: PlannedScreenChange, settled: PlanSettlement) {
    if (closed || state.phase !== 'planning' || state.job !== job) return;
    job.cancelPlanningTimeout();
    if (settled.type === 'threw') {
      failScreenChange(job, 'internal_error', { errorName: settled.errorName });
      return;
    }
    const { result } = settled;
    if (isErr(result)) {
      failScreenChange(job, result.error._tag);
      return;
    }
    const outcome = result.value;
    switch (outcome.type) {
      case 'needs_clarification':
        skipScreenChange(job, {
          reason: 'needs_clarification',
          question: outcome.question,
        });
        return;
      case 'response':
        if (isNoScreenChange(outcome.response, job.request))
          skipScreenChange(job, { reason: 'nothing_to_show' });
        else emitChange(job, outcome.response);
        return;
      default:
        assertNever(outcome, 'PlanOutcome');
    }
  }

  async function plan(job: PlannedScreenChange) {
    let settled: PlanSettlement;
    try {
      const result = await planner({
        request: job.request,
        messageId: job.messageId,
        owner: {
          runId: job.screenChange.runId,
          inputId: job.screenChange.inputId,
          turnId: job.screenChange.turnId,
        },
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
  }

  function pump() {
    while (!closed && state.phase === 'idle') {
      const screenChange = queue.shift();
      if (screenChange === undefined) return;
      if (chart === undefined) {
        logger.warn('Dropped a Screen Change with no known Chart', {
          runId: screenChange.runId,
          turnId: screenChange.turnId,
        });
        continue;
      }
      const controller = new AbortController();
      const job: PlannedScreenChange = {
        screenChange,
        changeId: ChangeId(crypto.randomUUID()),
        messageId: MessageId(crypto.randomUUID()),
        request: buildScreenChangeRequest(chart, screenChange.intent),
        controller,
        cancelPlanningTimeout: scheduleTimeout(() => {
          if (state.phase !== 'planning' || state.job !== job) return;
          controller.abort();
          failScreenChange(job, 'planning_timeout');
        }, planningTimeoutMs),
      };
      state = { phase: 'planning', job };
      void plan(job);
    }
  }
}

const PLANNER_FAILURE_TEXT = 'The screen could not be updated.';
const ACKNOWLEDGEMENT_TIMEOUT_TEXT = 'The UI acknowledgement did not arrive.';

interface PlannedScreenChange {
  readonly screenChange: ScreenChangeJob;
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
  | { readonly phase: 'planning'; readonly job: PlannedScreenChange }
  | {
      readonly phase: 'awaiting_ack';
      readonly job: PlannedScreenChange;
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
