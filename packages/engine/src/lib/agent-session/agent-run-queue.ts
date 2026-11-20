import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentRunMetrics,
  type AgentUiAppliedInput,
  type AgentUtteranceInput,
  type DiagnosticMetadata,
  RunId,
} from '@maelstrom-co/protocol';

import { assertNever } from '../assert-never.js';
import type { Logger } from '../logger.js';
import {
  type AgentRunContext,
  type AgentRunSetup,
  type ResolvedAgentConfig,
  resolveAgentRunSetup,
} from './agent-config.js';
import type { RunObserver } from './agent-diagnostics.js';
import {
  type AgentRunActivity,
  type AgentRunClock,
  type AgentRunEvent,
  type AgentRunFailed,
  type AgentRunFinished,
  type AgentRunInput,
  type AgentRunOptions,
  DEFAULT_AGENT_RUN_BUDGETS,
  runAgent,
} from './agent-run.js';
import type { OrderedEmitter } from './ordered-emitter.js';
import {
  type AgentRunCounters,
  buildAcceptanceEvents,
  buildRunEnding,
  type RunBudgetExhaustion,
  type RunFailure,
} from './run-events.js';
import type { ScreenChangeQueue } from './screen-change-queue.js';
import type { ToolResultStore } from './tool-result-store.js';
import { renderScreenNote, type Transcript } from './transcript.js';

/** Starts one Agent Run. Defaults to {@link runAgent}. */
export type AgentRunStarter = (
  input: AgentRunInput,
  options: AgentRunOptions,
) => AsyncIterable<AgentRunEvent>;

/** Everything a connection's {@link AgentRunQueue} needs. */
export interface AgentRunQueueOptions {
  /** The resolved agent slot of the Engine. */
  readonly agent: ResolvedAgentConfig;
  /** Who the connection acts for. Reaches only run setup and tool context. */
  readonly identity: AgentRunContext;
  /** The connection's ordered event stream. */
  readonly events: OrderedEmitter<AgentEvent>;
  /** Receives diagnostic observations of each run. */
  readonly observe: RunObserver;
  /** Receives setup and run failures. */
  readonly logger: Logger;
  /** Monotonic millisecond clock for run timing and budgets. */
  readonly clock: () => number;
  /** Schedules a callback and returns a function that cancels it. */
  readonly scheduleTimeout: AgentRunClock['scheduleTimeout'];
  /**
   * The connection's Screen Changes. Each run's `change_screen` calls go
   * there, and the queue closes them when it closes.
   */
  readonly screenChanges: ScreenChangeQueue;
  /**
   * Session transcript later runs build on, the one the Screen Changes record their
   * late notes in. The queue hands every screen note recorded in it to the active
   * run.
   */
  readonly transcript: Transcript;
  /** Session store of full tool results. */
  readonly toolResults: ToolResultStore;
  /** Starts each run. Defaults to {@link runAgent}. */
  readonly startRun?: AgentRunStarter;
}

/**
 * Serial Agent Runs of one connection, one at a time in arrival order. A run's
 * ending is emitted at once, but the next run starts only after every tool
 * call of the previous run that is not `read_only` has settled. A run
 * changes the screen only through its `change_screen` calls, whose turn
 * waits for their results, and a new run never waits for an earlier run's
 * Screen Change. A budget or error ending stops the run waiting like a
 * cancel. A screen note recorded after a run rendered its prior messages
 * reaches that run's next model turn.
 */
export interface AgentRunQueue {
  /** Queued runs plus the active one. */
  pendingRuns(): number;
  /** Accepts an utterance at once and resolves when its run has finished or the queue closed. */
  enqueue(input: AgentUtteranceInput): Promise<void>;
  /**
   * Cancels a run. The active run is aborted, drained and finished as
   * `cancelled`, dropping anything else it produces afterwards. A queued run
   * finishes as `cancelled` without starting. The run's queued Screen Changes are
   * dropped and its Screen Change in planning is aborted, their goals answering
   * `cancelled`, while its change already sent still awaits acknowledgement and
   * settles as a Screen Note. A run that already finished still has its
   * remaining Screen Changes dropped this way. A run that is neither active nor
   * queued and has no Screen Changes is ignored.
   */
  cancelRun(runId: RunId): void;
  /**
   * Settles the `change_screen` change awaiting acknowledgement. An unknown
   * `changeId` or a wrong outcome count is refused with an agent `error`
   * event.
   */
  acknowledge(input: AgentUiAppliedInput): void;
  /** Aborts the active run, drops all queued runs and Screen Changes. Emits nothing further. */
  close(): void;
}

/** Creates the {@link AgentRunQueue} of one connection. */
export function createAgentRunQueue({
  agent,
  identity,
  events,
  observe,
  logger,
  clock,
  scheduleTimeout,
  screenChanges,
  transcript,
  toolResults,
  startRun = runAgent,
}: AgentRunQueueOptions): AgentRunQueue {
  const queue: QueuedAgentRun[] = [];
  const runClock: AgentRunClock = { now: clock, scheduleTimeout };
  let active: ActiveAgentRun | undefined;
  let toolsSettling: Promise<void> | undefined;
  let closed = false;
  const stopScreenNotes = transcript.onScreenNote((_runId, turnId, text) => {
    active?.sessionNotes.push(renderScreenNote(turnId, text));
  });

  return {
    pendingRuns: () => queue.length + (active === undefined ? 0 : 1),
    enqueue(input) {
      if (closed) return Promise.resolve();
      const run: QueuedAgentRun = {
        input,
        runId: RunId(crypto.randomUUID()),
        done: deferred(),
      };
      queue.push(run);
      screenChanges.noteChart(input.chart);
      events.emit(...buildAcceptanceEvents(input.inputId, run.runId, 'agent'));
      observe(
        run.runId,
        input.inputId,
        'engine.agent.input.accepted',
        { source: input.source, disposition: 'agent' },
        () => ({ text: input.text }),
      );
      void pump();
      return run.done.promise;
    },
    cancelRun(runId) {
      if (closed) return;
      screenChanges.dropRun(runId);
      if (active?.runId === runId) {
        if (active.cancelled) return;
        active.cancelled = true;
        active.controller.abort(
          new DOMException('Agent run cancelled', 'AbortError'),
        );
        return;
      }
      const index = queue.findIndex((queued) => queued.runId === runId);
      if (index === -1) return;
      const [queued] = queue.splice(index, 1);
      if (queued === undefined) return;
      const now = clock();
      const ending = buildRunEnding(
        { runId, started: now },
        now,
        undefined,
        CANCELLED_FAILURE,
        ZERO_COUNTERS,
      );
      events.emit(...ending.events);
      observe(
        runId,
        queued.input.inputId,
        'engine.agent.run.finished',
        ending.metadata,
      );
      queued.done.resolve();
    },
    acknowledge(input) {
      if (closed) return;
      screenChanges.acknowledge(input);
    },
    close() {
      if (closed) return;
      closed = true;
      stopScreenNotes();
      screenChanges.close();
      const run = active;
      active = undefined;
      if (run !== undefined) {
        run.controller.abort(
          new DOMException('Agent connection closed', 'AbortError'),
        );
        run.iterator?.return?.().catch(() => undefined);
        run.done.resolve();
      }
      for (const queued of queue.splice(0)) queued.done.resolve();
    },
  };

  function isCurrent(run: ActiveAgentRun) {
    return !closed && active === run;
  }

  // Deliberately drops activity once the run is cancelled or stale, as
  // forward drops wire events, so a turn or tool can stay open until
  // run.finished closes it.
  function observeActivity(run: ActiveAgentRun, activity: AgentRunActivity) {
    if (!isCurrent(run) || run.cancelled) return;
    const { kind, metadata, readContent } = activityObservation(activity);
    observe(run.runId, run.input.inputId, kind, metadata, readContent);
  }

  function measuredSince(
    finished: AgentRunFinished,
    since: number,
  ): AgentRunFinished {
    return {
      ...finished,
      metrics: {
        ...finished.metrics,
        elapsedMs: Math.max(0, Math.round(clock() - since)),
      },
    };
  }

  function finish(
    run: ActiveAgentRun,
    finished: AgentRunFinished,
    toolsSettled?: Promise<void>,
  ) {
    if (finished.reason === 'budget') {
      transcript.recordClosingMessage(run.runId, finished.reply);
    }
    if (finished.reason === 'budget' || finished.reason === 'error') {
      screenChanges.dropRun(run.runId);
    }
    transcript.recordEnding(run.runId, finished);
    const now = clock();
    const ending = buildRunEnding(
      { runId: run.runId, started: now },
      now,
      replyOf(finished),
      wireOutcome(finished),
      {
        ...finished.metrics,
        unreportedUsageCalls: finished.unreportedUsageCalls,
      },
    );
    events.emit(...ending.events);
    observe(
      run.runId,
      run.input.inputId,
      'engine.agent.run.finished',
      ending.metadata,
    );
    active = undefined;
    run.done.resolve();
    if (toolsSettled === undefined) {
      void pump();
      return;
    }
    // A tool that ignored the abort may still perform its side effect, so the
    // next run must not start until it settles.
    const settling = Promise.resolve(toolsSettled)
      .catch(() => undefined)
      .then(() => {
        if (toolsSettling === settling) toolsSettling = undefined;
        void pump();
      });
    toolsSettling = settling;
  }

  function forward(run: ActiveAgentRun, event: AgentRunEvent) {
    const { runId } = run;
    switch (event.type) {
      case 'message':
        if (event.turnId === `${runId}:close`) return;
        transcript.recordMessage(runId, event.turnId, event.delta);
        events.emit({
          type: 'message',
          version: AGENT_WIRE_VERSION,
          runId,
          turnId: event.turnId,
          delta: event.delta,
        });
        return;
      case 'tool_call':
        transcript.recordToolCall(runId, event.callId, event.name, event.args);
        events.emit({
          type: 'tool_call',
          version: AGENT_WIRE_VERSION,
          runId,
          turnId: event.turnId,
          callId: event.callId,
          name: event.name,
        });
        return;
      case 'tool_result':
        transcript.recordToolResult(
          runId,
          event.callId,
          event.ok,
          event.summary,
        );
        events.emit({
          type: 'tool_result',
          version: AGENT_WIRE_VERSION,
          runId,
          turnId: event.turnId,
          callId: event.callId,
          name: event.name,
          ok: event.ok,
          summary: event.summary,
        });
        return;
      case 'tool_phase_ended':
        toolResults.recordToolPhase(runId, event);
        return;
      case 'finished':
        return;
    }
  }

  async function drive(run: ActiveAgentRun): Promise<void> {
    const turnBegan = clock();
    const priorMessages = transcript.renderPriorMessages();
    transcript.recordUserInput(run.runId, run.input.text);
    const aborted = whenAborted(run.controller.signal);
    const deadline = setupDeadline(agent, scheduleTimeout);
    let setup: AgentRunSetup | typeof SETUP_ABORTED | typeof SETUP_TIMED_OUT;
    try {
      setup = await Promise.race([
        resolveAgentRunSetup(agent, identity),
        aborted.promise,
        deadline.promise,
      ]);
    } catch (error) {
      if (!isCurrent(run)) return;
      if (run.cancelled) {
        finish(run, measuredSince(cancelledRun(ZERO_METRICS, 0), turnBegan));
        return;
      }
      logger.error('Agent run setup failed', error, { runId: run.runId });
      finish(run, measuredSince(SETUP_FAILURE, turnBegan));
      return;
    } finally {
      aborted.dispose();
      deadline.dispose();
    }
    if (!isCurrent(run)) return;
    if (setup === SETUP_ABORTED || run.controller.signal.aborted) {
      finish(run, measuredSince(cancelledRun(ZERO_METRICS, 0), turnBegan));
      return;
    }
    if (setup === SETUP_TIMED_OUT) {
      logger.error(
        'Agent run setup timed out',
        new Error('Agent run setup did not settle before its deadline'),
        { runId: run.runId },
      );
      finish(run, measuredSince(SETUP_FAILURE, turnBegan));
      return;
    }
    const started = clock();
    events.emit({
      type: 'started',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
    });
    if (!isCurrent(run)) return;
    observe(run.runId, run.input.inputId, 'engine.agent.run.started', {
      disposition: 'agent',
    });
    const iterator = startRun(
      {
        runId: run.runId,
        adapter: setup.adapter,
        instructions: agent.instructions,
        registry: agent.registry,
        vessels: run.input.chart.vessels,
        budgets: setup.budgets,
        ...(agent.retry === undefined ? {} : { retry: agent.retry }),
        priorMessages,
        utterance: run.input.text,
        identity,
        clock: runClock,
        logger,
        screenChanges: {
          request: (turnId, goals) =>
            screenChanges.request({
              runId: run.runId,
              inputId: run.input.inputId,
              turnId,
              goals,
            }),
          noteBatchFillTimeout: (turnId, counts) => {
            observe(
              run.runId,
              run.input.inputId,
              'engine.agent.screen_change.batch_fill_timeout',
              { turnId, ...counts },
            );
          },
        },
      },
      {
        signal: run.controller.signal,
        takeSessionNotes: () => run.sessionNotes.splice(0),
        onActivity: (activity) => observeActivity(run, activity),
      },
    )[Symbol.asyncIterator]();
    run.iterator = iterator;
    let finished: AgentRunFinished;
    for (;;) {
      let step: IteratorResult<AgentRunEvent>;
      try {
        step = await iterator.next();
      } catch (error) {
        if (!isCurrent(run)) return;
        logger.error('Agent run failed', error, { runId: run.runId });
        finished = measuredSince(RUN_FAILURE, started);
        break;
      }
      if (!isCurrent(run)) return;
      if (step.done === true) {
        finished = measuredSince(RUN_FAILURE, started);
        break;
      }
      if (step.value.type === 'finished') {
        finished = step.value;
        break;
      }
      if (!run.cancelled) forward(run, step.value);
    }
    finish(
      run,
      run.cancelled && finished.reason !== 'cancelled'
        ? cancelledRun(finished.metrics, finished.unreportedUsageCalls)
        : finished,
      finished.toolsSettled,
    );
  }

  async function pump(): Promise<void> {
    if (closed || active !== undefined || toolsSettling !== undefined) return;
    const next = queue.shift();
    if (next === undefined) return;
    const run: ActiveAgentRun = {
      ...next,
      controller: new AbortController(),
      cancelled: false,
      sessionNotes: [],
    };
    active = run;
    await drive(run);
  }
}

interface QueuedAgentRun {
  readonly input: AgentUtteranceInput;
  readonly runId: RunId;
  readonly done: Deferred;
}

interface ActiveAgentRun extends QueuedAgentRun {
  readonly controller: AbortController;
  iterator?: AsyncIterator<AgentRunEvent>;
  cancelled: boolean;
  readonly sessionNotes: string[];
}

const ZERO_METRICS: AgentRunMetrics = {
  turns: 0,
  toolCalls: { requested: 0, admitted: 0 },
  elapsedMs: 0,
  inputTokens: 0,
  outputTokens: 0,
};

const ZERO_COUNTERS: AgentRunCounters = {
  ...ZERO_METRICS,
  unreportedUsageCalls: 0,
};

const CANCELLED_FAILURE: RunFailure = {
  reason: 'cancelled',
  code: 'cancelled',
  error: 'The run was cancelled.',
};

const SETUP_FAILURE: AgentRunFailed = {
  type: 'finished',
  reason: 'error',
  code: 'setup_failed',
  error: 'The agent run could not start.',
  metrics: ZERO_METRICS,
  unreportedUsageCalls: 0,
};

const RUN_FAILURE: AgentRunFailed = {
  ...SETUP_FAILURE,
  code: 'run_failed',
  error: 'The agent run failed.',
};

const SETUP_ABORTED = Symbol('agent run setup aborted');

interface AbortWatch {
  readonly promise: Promise<typeof SETUP_ABORTED>;
  readonly dispose: () => void;
}

function whenAborted(signal: AbortSignal): AbortWatch {
  if (signal.aborted) {
    return { promise: Promise.resolve(SETUP_ABORTED), dispose: () => {} };
  }
  let dispose = () => {};
  const promise = new Promise<typeof SETUP_ABORTED>((resolve) => {
    const onAbort = () => resolve(SETUP_ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    dispose = () => signal.removeEventListener('abort', onAbort);
  });
  return { promise, dispose };
}

const SETUP_TIMED_OUT = Symbol('agent run setup timed out');

interface SetupDeadline {
  readonly promise: Promise<typeof SETUP_TIMED_OUT>;
  readonly dispose: () => void;
}

// A resolver's own elapsed cap is unknown until it settles, so its setup is
// bounded by the default cap instead.
function setupDeadline(
  agent: ResolvedAgentConfig,
  scheduleTimeout: AgentRunClock['scheduleTimeout'],
): SetupDeadline {
  const limitMs =
    typeof agent.budgets === 'function'
      ? DEFAULT_AGENT_RUN_BUDGETS.maxElapsedMs
      : agent.budgets.maxElapsedMs;
  if (!Number.isFinite(limitMs)) {
    return { promise: new Promise(() => {}), dispose: () => {} };
  }
  let dispose = () => {};
  const promise = new Promise<typeof SETUP_TIMED_OUT>((resolve) => {
    dispose = scheduleTimeout(() => resolve(SETUP_TIMED_OUT), limitMs);
  });
  return { promise, dispose };
}

function cancelledRun(
  metrics: AgentRunMetrics,
  unreportedUsageCalls: number,
): AgentRunFinished {
  return {
    type: 'finished',
    reason: 'cancelled',
    cause: undefined,
    metrics,
    unreportedUsageCalls,
  };
}

function replyOf(finished: AgentRunFinished): string | undefined {
  switch (finished.reason) {
    case 'completed':
    case 'budget':
      return finished.reply;
    case 'error':
    case 'cancelled':
      return undefined;
    default:
      return assertNever(finished, 'agent run ending');
  }
}

function wireOutcome(
  finished: AgentRunFinished,
): RunFailure | RunBudgetExhaustion | undefined {
  switch (finished.reason) {
    case 'completed':
      return undefined;
    case 'budget':
      return {
        reason: 'budget',
        limit: finished.limit,
        closingMessage: finished.reply,
      };
    case 'error':
      return { reason: 'error', code: finished.code, error: finished.error };
    case 'cancelled':
      return CANCELLED_FAILURE;
    default:
      return assertNever(finished, 'agent run ending');
  }
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

function activityObservation(activity: AgentRunActivity): {
  readonly kind: string;
  readonly metadata: DiagnosticMetadata;
  readonly readContent?: () => unknown;
} {
  switch (activity.type) {
    case 'turn_started':
      return {
        kind: 'engine.agent.turn.started',
        metadata: { turnId: activity.turnId, turnIndex: activity.turnIndex },
      };
    case 'turn_finished':
      return {
        kind: 'engine.agent.turn.finished',
        metadata: {
          turnId: activity.turnId,
          turnIndex: activity.turnIndex,
          toolCallsRequested: activity.toolCalls.requested,
          toolCallsAdmitted: activity.toolCalls.admitted,
          ...(activity.inputTokens === undefined
            ? {}
            : { inputTokens: activity.inputTokens }),
          ...(activity.outputTokens === undefined
            ? {}
            : { outputTokens: activity.outputTokens }),
        },
        readContent: () => ({ text: activity.text }),
      };
    case 'tool_started':
      return {
        kind: 'engine.agent.tool.started',
        metadata: {
          turnId: activity.turnId,
          callId: activity.callId,
          toolName: activity.name,
        },
        readContent: () => ({ args: activity.args }),
      };
    case 'tool_completed':
      return {
        kind: 'engine.agent.tool.completed',
        metadata: {
          turnId: activity.turnId,
          callId: activity.callId,
          toolName: activity.name,
          outcome: activity.outcome,
          ...(activity.durationMs === undefined
            ? {}
            : { durationMs: activity.durationMs }),
        },
        readContent: () => ({ result: activity.result }),
      };
    default:
      return assertNever(activity, 'agent run activity');
  }
}
