import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentRunMetrics,
  type AgentUtteranceInput,
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
import {
  type AgentRunClock,
  type AgentRunEvent,
  type AgentRunFailed,
  type AgentRunFinished,
  type AgentRunInput,
  type AgentRunOptions,
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
import type { RunObserver } from './run-scheduler.js';
import {
  createToolResultStore,
  type ToolResultStore,
} from './tool-result-store.js';
import {
  createTranscript,
  TRANSCRIPT_MAX_CHARS,
  type Transcript,
} from './transcript.js';

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
   * Session transcript later runs build on. Defaults to a new one bounded by
   * {@link TRANSCRIPT_MAX_CHARS}.
   */
  readonly transcript?: Transcript;
  /** Session store of full tool results. Defaults to a new one. */
  readonly toolResults?: ToolResultStore;
  /** Starts each run. Defaults to {@link runAgent}. */
  readonly startRun?: AgentRunStarter;
}

/**
 * Serial Agent Runs of one connection, one at a time in arrival order. A run's
 * ending is emitted at once, but the next run starts only after every tool
 * call of the previous run that is not `read_only` has settled.
 */
export interface AgentRunQueue {
  /** Queued runs plus the active one. */
  pendingRuns(): number;
  /** Accepts an utterance at once and resolves when its run has finished or the queue closed. */
  enqueue(input: AgentUtteranceInput): Promise<void>;
  /**
   * Cancels a run. The active run is aborted, drained and finished as
   * `cancelled`, dropping anything else it produces afterwards. A queued run
   * finishes as `cancelled` without starting. Unknown runs are ignored.
   */
  cancelRun(runId: RunId): void;
  /** Aborts the active run and drops all queued ones. Emits nothing further. */
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
  transcript = createTranscript({ maxChars: TRANSCRIPT_MAX_CHARS }),
  toolResults = createToolResultStore(),
  startRun = runAgent,
}: AgentRunQueueOptions): AgentRunQueue {
  const queue: QueuedAgentRun[] = [];
  const runClock: AgentRunClock = { now: clock, scheduleTimeout };
  let active: ActiveAgentRun | undefined;
  let toolsSettling: Promise<void> | undefined;
  let closed = false;

  const isCurrent = (run: ActiveAgentRun) => !closed && active === run;

  const finish = (
    run: ActiveAgentRun,
    finished: AgentRunFinished,
    since: number,
    toolsSettled?: Promise<void>,
  ) => {
    if (finished.reason === 'budget') {
      transcript.recordClosingMessage(run.runId, finished.reply);
    }
    transcript.recordEnding(run.runId, finished);
    const ending = buildRunEnding(
      { runId: run.runId, started: since },
      clock(),
      finished.reply,
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
  };

  const forward = (run: ActiveAgentRun, event: AgentRunEvent) => {
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
  };

  const drive = async (run: ActiveAgentRun): Promise<void> => {
    const turnBegan = clock();
    const priorMessages = transcript.renderPriorMessages();
    transcript.recordUserInput(run.runId, run.input.text);
    const aborted = whenAborted(run.controller.signal);
    let setup: AgentRunSetup | typeof SETUP_ABORTED;
    try {
      setup = await Promise.race([
        resolveAgentRunSetup(agent, identity),
        aborted.promise,
      ]);
    } catch (error) {
      if (!isCurrent(run)) return;
      if (run.cancelled) {
        finish(run, cancelledRun(ZERO_METRICS, 0), turnBegan);
        return;
      }
      logger.error('Agent run setup failed', error, { runId: run.runId });
      finish(run, SETUP_FAILURE, turnBegan);
      return;
    } finally {
      aborted.dispose();
    }
    if (!isCurrent(run)) return;
    if (setup === SETUP_ABORTED || run.controller.signal.aborted) {
      finish(run, cancelledRun(ZERO_METRICS, 0), turnBegan);
      return;
    }
    const started = clock();
    events.emit({
      type: 'started',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
    });
    const iterator = startRun(
      {
        runId: run.runId,
        adapter: setup.adapter,
        instructions: agent.instructions,
        registry: agent.registry,
        budgets: setup.budgets,
        ...(agent.retry === undefined ? {} : { retry: agent.retry }),
        priorMessages,
        utterance: run.input.text,
        identity,
        clock: runClock,
        logger,
      },
      { signal: run.controller.signal },
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
        finished = RUN_FAILURE;
        break;
      }
      if (!isCurrent(run)) return;
      if (step.done === true) {
        finished = RUN_FAILURE;
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
      started,
      finished.toolsSettled,
    );
  };

  const pump = async (): Promise<void> => {
    if (closed || active !== undefined || toolsSettling !== undefined) return;
    const next = queue.shift();
    if (next === undefined) return;
    const run: ActiveAgentRun = {
      ...next,
      controller: new AbortController(),
      cancelled: false,
    };
    active = run;
    await drive(run);
  };

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
        '',
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
    close() {
      if (closed) return;
      closed = true;
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
}

const ZERO_METRICS: AgentRunMetrics = {
  turns: 0,
  toolCalls: 0,
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
  reply: '',
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

function cancelledRun(
  metrics: AgentRunMetrics,
  unreportedUsageCalls: number,
): AgentRunFinished {
  return {
    type: 'finished',
    reason: 'cancelled',
    reply: '',
    cause: undefined,
    metrics,
    unreportedUsageCalls,
  };
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
