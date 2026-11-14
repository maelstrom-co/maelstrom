import type {
  AgentConversationEvents,
  ConversationLostEvent,
  ConversationLostReason,
  MessageId,
} from '@maelstrom-co/client';
import type {
  AgentFinishReason,
  AgentRunMetrics,
  ChangeId,
  RunId,
} from '@maelstrom-co/protocol';

/** How far an Agent Run has progressed. */
export type AgentRunStatus =
  | 'pending'
  | 'working'
  | 'streaming'
  | 'finished'
  | 'failed'
  | 'lost';

/** A failure reported for an Agent Run or the conversation. */
export type AgentRunError = {
  /** Human-readable failure description. */
  readonly message: string;
  /** Machine-readable failure kind, when the agent sent one. */
  readonly code?: string;
};

/** The structured outcome of an Agent Run that ended. */
export type AgentRunOutcome = {
  /** Whether the run ended as intended. */
  readonly ok: boolean;
  /** Why the run ended. */
  readonly reason: AgentFinishReason;
  /** Cost counters for the run. */
  readonly metrics: Readonly<AgentRunMetrics>;
};

/** A UI change the Orchestrator applied for an Agent Run. */
export type AgentRunChange = {
  /** The change the agent sent. */
  readonly changeId: ChangeId;
};

/** Everything known about one input and the Agent Run that handles it. */
export type AgentRunState = {
  /** The input that started the run, as resolved by `sendMessage`. */
  readonly inputId: MessageId;
  /** The run that handles the input, once the agent accepted it. */
  readonly runId: RunId | null;
  /** How far the run has progressed. */
  readonly status: AgentRunStatus;
  /** The latest placeholder text to show while the agent works. */
  readonly placeholder: string | null;
  /**
   * Streamed text of the current model turn, replaced by the final reply when
   * the run finishes with one.
   */
  readonly reply: string;
  /** The model turn the streamed reply belongs to. */
  readonly turnId: string | null;
  /** Applied UI changes in arrival order. */
  readonly changes: readonly AgentRunChange[];
  /** The failure that ended or interrupted the run. */
  readonly error: AgentRunError | null;
  /** Why the run was lost, set only while the status is `lost`. */
  readonly lostReason: ConversationLostReason | null;
  /** The outcome the agent reported when the run ended. */
  readonly finished: AgentRunOutcome | null;
};

/** Agent Run state of one Orchestrator, folded from its agent events. */
export type AgentRunsSnapshot = {
  /** The run of the most recent input. */
  readonly run: AgentRunState | null;
  /** Known runs, oldest first, capped at {@link AGENT_RUNS_CAP}. */
  readonly runs: readonly AgentRunState[];
  /** The latest failure not tied to any input or run. */
  readonly error: AgentRunError | null;
};

/** Records that `sendMessage` resolved to `inputId`. */
export type AgentInputSentAction = {
  /** Discriminant, always `'input_sent'`. */
  readonly type: 'input_sent';
  /** The input `sendMessage` resolved to. */
  readonly inputId: MessageId;
};

/** Anything that can change Agent Run state. */
export type AgentRunEvent =
  | AgentConversationEvents[keyof AgentConversationEvents]
  | AgentInputSentAction;

/** How many runs a snapshot keeps before it evicts the oldest. */
export const AGENT_RUNS_CAP = 20;

/** The snapshot before any input was sent or any event arrived. */
export const EMPTY_AGENT_RUNS: AgentRunsSnapshot = Object.freeze({
  run: null,
  runs: Object.freeze([]),
  error: null,
});

/**
 * Folds one agent event or input registration into the snapshot. Returns the
 * same snapshot object when the event changes nothing, and never mutates its
 * input.
 */
export function reduceAgentRuns(
  snapshot: AgentRunsSnapshot,
  event: AgentRunEvent,
): AgentRunsSnapshot {
  switch (event.type) {
    case 'input_sent': {
      const registered = upsertByInput(snapshot, event.inputId);
      return registered.error === null
        ? registered
        : { ...registered, error: null };
    }
    case 'placeholder':
      return updateByInput(snapshot, event.inputId, (run) =>
        patch(run, { placeholder: event.text, ...resume(run) }),
      );
    case 'accepted':
      return updateByInput(snapshot, event.inputId, (run) => {
        if (event.runId === null) {
          return run.runId === null && !isEnded(run)
            ? patch(run, { status: 'finished', reply: '', lostReason: null })
            : run;
        }
        return patch(run, { runId: run.runId ?? event.runId, ...resume(run) });
      });
    case 'message':
      return updateByRun(snapshot, event.runId, (run) => {
        if (isEnded(run)) return run;
        const sameTurn = run.turnId === event.turnId;
        return patch(run, {
          reply: sameTurn ? run.reply + event.delta : event.delta,
          turnId: event.turnId,
          status: 'streaming',
          lostReason: null,
        });
      });
    case 'ui_change': {
      if (event.runId === null) return snapshot;
      const changeId = event.changeId;
      return updateByRun(snapshot, event.runId, (run) =>
        patch(run, { changes: [...run.changes, { changeId }], ...resume(run) }),
      );
    }
    case 'finished':
      return updateByRun(snapshot, event.runId, (run) => {
        if (run.finished !== null) return run;
        return patch(run, {
          status: event.ok ? 'finished' : 'failed',
          reply: event.reply ?? run.reply,
          lostReason: null,
          error: event.ok
            ? run.error
            : toError(event.error ?? event.reason, event.code),
          finished: {
            ok: event.ok,
            reason: event.reason,
            metrics: event.metrics,
          },
        });
      });
    case 'error': {
      const fail = (run: AgentRunState): AgentRunState =>
        patch(run, {
          status: 'failed',
          error: toError(event.error, event.code),
          lostReason: null,
        });
      if (event.runId !== undefined && indexOfRun(snapshot, event.runId) >= 0) {
        return updateByRun(snapshot, event.runId, fail);
      }
      if (event.inputId !== undefined) {
        return updateByInput(snapshot, event.inputId, fail);
      }
      if (event.runId !== undefined) return snapshot;
      return { ...snapshot, error: toError(event.error, event.code) };
    }
    case 'conversation_lost':
      return applyConversationLost(snapshot, event);
    default:
      return assertNever(event, 'Unhandled agent run event');
  }
}

function applyConversationLost(
  snapshot: AgentRunsSnapshot,
  event: ConversationLostEvent,
): AgentRunsSnapshot {
  if (event.reason !== 'stale_run') {
    const reason = event.reason;
    let changed = false;
    const runs = snapshot.runs.map((run) => {
      if (!isOpen(run) && !isStaleLost(run)) return run;
      changed = true;
      return { ...run, status: 'lost' as const, lostReason: reason };
    });
    return changed ? withRuns(snapshot, runs) : snapshot;
  }
  const markStale = (run: AgentRunState): AgentRunState =>
    isOpen(run) ? patch(run, { status: 'lost', lostReason: 'stale_run' }) : run;
  if (event.runId !== undefined) {
    return updateByRun(snapshot, event.runId, markStale);
  }
  const index = indexOfInput(snapshot, event.inputId);
  return index < 0 ? snapshot : replaceAt(snapshot, index, markStale);
}

function upsertByInput(
  snapshot: AgentRunsSnapshot,
  inputId: MessageId,
): AgentRunsSnapshot {
  if (indexOfInput(snapshot, inputId) >= 0) return snapshot;
  const runs = [...snapshot.runs, createRun(inputId)];
  return withRuns(
    snapshot,
    runs.length > AGENT_RUNS_CAP ? runs.slice(-AGENT_RUNS_CAP) : runs,
  );
}

function updateByInput(
  snapshot: AgentRunsSnapshot,
  inputId: MessageId,
  update: (run: AgentRunState) => AgentRunState,
): AgentRunsSnapshot {
  const registered = upsertByInput(snapshot, inputId);
  return replaceAt(registered, indexOfInput(registered, inputId), update);
}

function updateByRun(
  snapshot: AgentRunsSnapshot,
  runId: RunId,
  update: (run: AgentRunState) => AgentRunState,
): AgentRunsSnapshot {
  const index = indexOfRun(snapshot, runId);
  return index < 0 ? snapshot : replaceAt(snapshot, index, update);
}

function replaceAt(
  snapshot: AgentRunsSnapshot,
  index: number,
  update: (run: AgentRunState) => AgentRunState,
): AgentRunsSnapshot {
  const current = snapshot.runs[index];
  if (current === undefined || isPermanentlyLost(current)) return snapshot;
  const next = update(current);
  if (next === current) return snapshot;
  const runs = [...snapshot.runs];
  runs[index] = next;
  return withRuns(snapshot, runs);
}

function withRuns(
  snapshot: AgentRunsSnapshot,
  runs: readonly AgentRunState[],
): AgentRunsSnapshot {
  return { ...snapshot, runs, run: runs[runs.length - 1] ?? null };
}

function patch(
  run: AgentRunState,
  fields: Partial<AgentRunState>,
): AgentRunState {
  const changed = (Object.keys(fields) as (keyof AgentRunState)[]).some(
    (key) => !Object.is(run[key], fields[key]),
  );
  return changed ? { ...run, ...fields } : run;
}

function resume(run: AgentRunState): Partial<AgentRunState> {
  return run.status === 'pending' || isStaleLost(run)
    ? { status: 'working', lostReason: null }
    : {};
}

function createRun(inputId: MessageId): AgentRunState {
  return {
    inputId,
    runId: null,
    status: 'pending',
    placeholder: null,
    reply: '',
    turnId: null,
    changes: [],
    error: null,
    lostReason: null,
    finished: null,
  };
}

function toError(message: string, code: string | undefined): AgentRunError {
  return code === undefined ? { message } : { message, code };
}

function indexOfInput(snapshot: AgentRunsSnapshot, inputId: MessageId): number {
  return snapshot.runs.findIndex((run) => run.inputId === inputId);
}

function indexOfRun(snapshot: AgentRunsSnapshot, runId: RunId): number {
  return snapshot.runs.findIndex((run) => run.runId === runId);
}

function isOpen(run: AgentRunState): boolean {
  return (
    run.status === 'pending' ||
    run.status === 'working' ||
    run.status === 'streaming'
  );
}

function isEnded(run: AgentRunState): boolean {
  return run.status === 'finished' || run.status === 'failed';
}

function isStaleLost(run: AgentRunState): boolean {
  return run.status === 'lost' && run.lostReason === 'stale_run';
}

function isPermanentlyLost(run: AgentRunState): boolean {
  return run.status === 'lost' && run.lostReason !== 'stale_run';
}

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
