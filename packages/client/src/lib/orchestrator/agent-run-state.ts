import type {
  AgentDisposition,
  AgentFinishReason,
  AgentRunMetrics,
  ChangeId,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';

import type {
  AgentConversationEvents,
  ConversationLostEvent,
  ConversationLostReason,
} from './conversation-event.types.js';

/**
 * A failure reported for an Agent Run or the conversation.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunError = {
  /** Human-readable failure description. */
  readonly message: string;
  /** Machine-readable failure kind, when one is known. */
  readonly code?: string;
};

/**
 * How an Agent Run ended, as the agent reported it.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunOutcome = {
  /** Why the run ended. */
  readonly reason: AgentFinishReason;
  /** Cost counters for the run. */
  readonly metrics: Readonly<AgentRunMetrics>;
};

/**
 * A UI change the Orchestrator applied for an Agent Run.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunChange = {
  /** The change the agent sent. */
  readonly changeId: ChangeId;
};

/**
 * A loop-driven UI change of an Agent Run that failed to plan or apply. It does
 * not end the run and can arrive after the run finished.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunChangeError = {
  /**
   * The failed change, when the agent named one. It may name a change that no
   * applied UI change carried.
   */
  readonly changeId: ChangeId | null;
  /** Human-readable failure description. */
  readonly message: string;
  /** Machine-readable failure kind, when the agent sent one. */
  readonly code?: string;
};

/**
 * Why an input or its Agent Run was lost. The conversation reasons come from
 * `conversation_lost`. `send_failed` means the transport refused the input
 * frame, so whether the agent saw it is unknown.
 *
 * `stale_run` and `send_failed` are recoverable: later events for the input
 * still move its state on. `disconnected` and `connector_replaced` are final.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunLostReason = ConversationLostReason | 'send_failed';

/**
 * Fields every Agent Run state carries, whatever its status.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunBase = {
  /** The input that started the run, as returned by `sendMessage`. */
  readonly inputId: MessageId;
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
  /**
   * Failed UI changes of the run in arrival order, kept apart from `changes`
   * because their change may never have been applied.
   */
  readonly changeErrors: readonly AgentRunChangeError[];
};

/**
 * Acceptance fields of an input the agent accepted into an Agent Run.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunAccepted = {
  /** The Agent Run that handles the input. */
  readonly runId: RunId;
  /** How the agent decided to handle the input. */
  readonly disposition: Exclude<AgentDisposition, 'noise'>;
  /** The short acknowledgement the agent sent on acceptance. */
  readonly ack: string;
};

/**
 * Acceptance fields of an input the agent has not accepted.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunNotAccepted = {
  /** Always `null`, no run handles the input yet. */
  readonly runId: null;
  /** Always `null`, the agent has not decided how to handle the input. */
  readonly disposition: null;
  /** Always `null`, the agent has not acknowledged the input. */
  readonly ack: null;
};

/**
 * The input was sent and the agent has not accepted it yet.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunPending = AgentRunBase &
  AgentRunNotAccepted & {
    /** Discriminant, always `'pending'`. */
    readonly status: 'pending';
  };

/**
 * The agent accepted the input and its Agent Run is working.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunWorking = AgentRunBase &
  AgentRunAccepted & {
    /** Discriminant, always `'working'`. */
    readonly status: 'working';
  };

/**
 * The Agent Run is streaming a reply.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunStreaming = AgentRunBase &
  AgentRunAccepted & {
    /** Discriminant, always `'streaming'`. */
    readonly status: 'streaming';
  };

/**
 * The Agent Run ended as intended. Its UI changes may still be applying, and
 * a failed loop-driven UI change can still arrive in `changeErrors`.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunFinished = AgentRunBase &
  AgentRunAccepted & {
    /** Discriminant, always `'finished'`. */
    readonly status: 'finished';
    /** How the run ended. */
    readonly outcome: AgentRunOutcome;
  };

/**
 * The agent accepted the input as noise and started no Agent Run.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunIgnored = AgentRunBase & {
  /** Discriminant, always `'ignored'`. */
  readonly status: 'ignored';
  /** Always `null`, no run starts for noise. */
  readonly runId: null;
  /** Always `'noise'`. */
  readonly disposition: 'noise';
  /** The short acknowledgement the agent sent on acceptance. */
  readonly ack: string;
};

/**
 * The agent rejected the input or its Agent Run ended without reaching its
 * goal. A rejected input was never accepted.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunFailed = AgentRunBase &
  (AgentRunAccepted | AgentRunNotAccepted) & {
    /** Discriminant, always `'failed'`. */
    readonly status: 'failed';
    /** Why the input or run failed. */
    readonly error: AgentRunError;
    /**
     * How the run ended, when the agent reported a run ending. `null` when
     * the agent rejected the input.
     */
    readonly outcome: AgentRunOutcome | null;
  };

/**
 * The input or its Agent Run was lost, so its outcome is unknown and its side
 * effects may have happened. Never resend it automatically.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunLost = AgentRunBase &
  (AgentRunAccepted | AgentRunNotAccepted) & {
    /** Discriminant, always `'lost'`. */
    readonly status: 'lost';
    /** Why the input or run was lost. */
    readonly lostReason: AgentRunLostReason;
  };

/**
 * The input never left the client, so it had no side effect.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunNotSubmitted = AgentRunBase &
  AgentRunNotAccepted & {
    /** Discriminant, always `'not_submitted'`. */
    readonly status: 'not_submitted';
    /** Why the input was not sent. */
    readonly error: AgentRunError;
  };

/**
 * Everything known about one input and the Agent Run that handles it.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunState =
  | AgentRunPending
  | AgentRunWorking
  | AgentRunStreaming
  | AgentRunFinished
  | AgentRunIgnored
  | AgentRunFailed
  | AgentRunLost
  | AgentRunNotSubmitted;

/**
 * How far an input and its Agent Run have progressed.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunStatus = AgentRunState['status'];

/**
 * An Agent Run state whose status no longer changes on its own.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type SettledAgentRun =
  | AgentRunFinished
  | AgentRunIgnored
  | AgentRunFailed
  | AgentRunLost
  | AgentRunNotSubmitted;

/**
 * Agent Run state of one Orchestrator, folded from its agent events.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentRunsSnapshot = {
  /** The run of the most recently sent input. */
  readonly run: AgentRunState | null;
  /** Known runs, oldest first, capped at the 20 most recent inputs. */
  readonly runs: readonly AgentRunState[];
  /**
   * The latest failure not tied to any input or run. Cleared when the next
   * input is sent.
   */
  readonly error: AgentRunError | null;
};

/**
 * Returns whether the run reached a settled status. A run lost to
 * `stale_run` or `send_failed` counts as settled even though later events
 * may still move it on.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export function isSettled(run: AgentRunState): run is SettledAgentRun {
  switch (run.status) {
    case 'pending':
    case 'working':
    case 'streaming':
      return false;
    case 'finished':
    case 'ignored':
    case 'failed':
    case 'lost':
    case 'not_submitted':
      return true;
    default:
      return assertNever(run, 'Unhandled agent run status');
  }
}

/** How many runs a snapshot keeps before it evicts the oldest. */
export const AGENT_RUNS_CAP = 20;

/** The snapshot before any input was sent. */
export const EMPTY_AGENT_RUNS: AgentRunsSnapshot = Object.freeze({
  run: null,
  runs: Object.freeze([]),
  error: null,
});

/** Every run the tracker knows, uncapped, plus the conversation-level error. */
export type AgentRunEntries = {
  /** Known runs in send order. */
  readonly runs: readonly AgentRunState[];
  /** The latest failure not tied to any input or run. */
  readonly error: AgentRunError | null;
};

/** Changes the client itself makes to an input's state around its send. */
export type AgentInputAction =
  | {
      /** The input is about to be handed to the connector. */
      readonly type: 'input_sent';
      /** The new input. */
      readonly inputId: MessageId;
    }
  | {
      /** The input never left the client. */
      readonly type: 'input_not_submitted';
      /** The input that was not sent. */
      readonly inputId: MessageId;
      /** Why it was not sent. */
      readonly error: AgentRunError;
    }
  | {
      /** The transport refused the input frame. */
      readonly type: 'input_send_failed';
      /** The input whose send failed. */
      readonly inputId: MessageId;
    };

/** Anything that can change Agent Run state. */
export type AgentRunEvent =
  | AgentConversationEvents[keyof AgentConversationEvents]
  | AgentInputAction;

/** The entries before any input was sent. */
export const EMPTY_AGENT_RUN_ENTRIES: AgentRunEntries = Object.freeze({
  runs: Object.freeze([]),
  error: null,
});

/**
 * Folds one agent event or input action into the entries. Returns the same
 * object when nothing changed, and never mutates its input. Events for
 * inputs or runs the entries do not know are ignored.
 */
export function reduceAgentRuns(
  entries: AgentRunEntries,
  event: AgentRunEvent,
): AgentRunEntries {
  switch (event.type) {
    case 'input_sent':
      if (indexOfInput(entries, event.inputId) >= 0) return entries;
      return {
        runs: [...entries.runs, createPending(event.inputId)],
        error: null,
      };
    case 'input_not_submitted': {
      const index = indexOfInput(entries, event.inputId);
      const notSubmitted = (run: AgentRunBase): AgentRunNotSubmitted => ({
        ...baseOf(run),
        ...NOT_ACCEPTED,
        status: 'not_submitted',
        error: event.error,
      });
      if (index < 0) {
        return {
          runs: [...entries.runs, notSubmitted(createPending(event.inputId))],
          error: null,
        };
      }
      return replaceAt(entries, index, (run) =>
        run.status === 'pending' ? notSubmitted(run) : run,
      );
    }
    case 'input_send_failed':
      return updateByInput(entries, event.inputId, (run) =>
        run.status === 'pending'
          ? { ...run, status: 'lost', lostReason: 'send_failed' }
          : run,
      );
    case 'placeholder':
      return updateByInput(entries, event.inputId, (run) => {
        if (!canProgress(run) && !isEnded(run)) return run;
        const text = event.text;
        if (run.status === 'lost') {
          return run.runId === null
            ? {
                ...baseOf(run),
                ...NOT_ACCEPTED,
                status: 'pending',
                placeholder: text,
              }
            : {
                ...baseOf(run),
                ...acceptanceOf(run),
                status: 'working',
                placeholder: text,
              };
        }
        return run.placeholder === text ? run : { ...run, placeholder: text };
      });
    case 'accepted':
      return updateByInput(entries, event.inputId, (run) => {
        if (run.runId !== null || !canProgress(run)) return run;
        if (event.runId === null || event.disposition === 'noise') {
          return {
            ...baseOf(run),
            status: 'ignored',
            runId: null,
            disposition: 'noise',
            ack: event.ack,
          };
        }
        return {
          ...baseOf(run),
          status: 'working',
          runId: event.runId,
          disposition: event.disposition,
          ack: event.ack,
        };
      });
    case 'message':
      return updateByRun(entries, event.runId, (run) => {
        if (!canProgress(run) || run.runId === null) return run;
        const sameTurn = run.turnId === event.turnId;
        return {
          ...baseOf(run),
          ...acceptanceOf(run),
          status: 'streaming',
          reply: sameTurn ? run.reply + event.delta : event.delta,
          turnId: event.turnId,
        };
      });
    case 'ui_change': {
      if (event.runId === null) return entries;
      const change: AgentRunChange = { changeId: event.changeId };
      return updateByRun(entries, event.runId, (run) => {
        const changes = [...run.changes, change];
        if (run.status === 'lost' && run.runId !== null) {
          return {
            ...baseOf(run),
            ...acceptanceOf(run),
            status: 'working',
            changes,
          };
        }
        return { ...run, changes };
      });
    }
    case 'finished':
      return updateByRun(entries, event.runId, (run) => {
        if (!canProgress(run) || run.runId === null) return run;
        const outcome: AgentRunOutcome = {
          reason: event.reason,
          metrics: event.metrics,
        };
        const base = {
          ...baseOf(run),
          ...acceptanceOf(run),
          reply: event.reply ?? run.reply,
          outcome,
        };
        return event.ok
          ? { ...base, status: 'finished' }
          : {
              ...base,
              status: 'failed',
              error: toError(event.error ?? event.reason, event.code),
            };
      });
    case 'error': {
      if (event.runId !== undefined) {
        const changeError: AgentRunChangeError = {
          changeId: event.changeId ?? null,
          ...toError(event.error, event.code),
        };
        return updateByRun(entries, event.runId, (run) => ({
          ...run,
          changeErrors: [...run.changeErrors, changeError],
        }));
      }
      if (event.inputId !== undefined) {
        return updateByInput(entries, event.inputId, (run) => {
          if (!canProgress(run)) return run;
          const error = toError(event.error, event.code);
          return run.runId === null
            ? {
                ...baseOf(run),
                ...NOT_ACCEPTED,
                status: 'failed',
                error,
                outcome: null,
              }
            : {
                ...baseOf(run),
                ...acceptanceOf(run),
                status: 'failed',
                error,
                outcome: null,
              };
        });
      }
      return { ...entries, error: toError(event.error, event.code) };
    }
    case 'conversation_lost':
      return reduceConversationLost(entries, event, NO_INPUTS);
    default:
      return assertNever(event, 'Unhandled agent run event');
  }
}

const NO_INPUTS: ReadonlySet<MessageId> = new Set();

const NOT_ACCEPTED: AgentRunNotAccepted = {
  runId: null,
  disposition: null,
  ack: null,
};

/**
 * Folds a `conversation_lost` into the entries, as {@link reduceAgentRuns}
 * does, except that the inputs in `handingOff` stay untouched. They are
 * registered but not yet handed to the connector, so the agent cannot have
 * seen them and the sender reports them as not submitted instead.
 */
export function reduceConversationLost(
  entries: AgentRunEntries,
  event: ConversationLostEvent,
  handingOff: ReadonlySet<MessageId>,
): AgentRunEntries {
  const reason = event.reason;
  const shouldMark =
    reason === 'stale_run'
      ? isOpen
      : (run: AgentRunState) => isOpen(run) || isRecoverablyLost(run);
  let changed = false;
  const runs = entries.runs.map((run): AgentRunState => {
    if (handingOff.has(run.inputId) || !shouldMark(run)) return run;
    changed = true;
    return run.runId === null
      ? { ...baseOf(run), ...NOT_ACCEPTED, status: 'lost', lostReason: reason }
      : {
          ...baseOf(run),
          ...acceptanceOf(run as AgentRunState & AgentRunAccepted),
          status: 'lost',
          lostReason: reason,
        };
  });
  return changed ? { ...entries, runs } : entries;
}

function updateByInput(
  entries: AgentRunEntries,
  inputId: MessageId,
  update: (run: AgentRunState) => AgentRunState,
): AgentRunEntries {
  return replaceAt(entries, indexOfInput(entries, inputId), update);
}

function updateByRun(
  entries: AgentRunEntries,
  runId: RunId,
  update: (run: AgentRunState) => AgentRunState,
): AgentRunEntries {
  return replaceAt(
    entries,
    entries.runs.findIndex((run) => run.runId === runId),
    update,
  );
}

function replaceAt(
  entries: AgentRunEntries,
  index: number,
  update: (run: AgentRunState) => AgentRunState,
): AgentRunEntries {
  const current = entries.runs[index];
  if (
    current === undefined ||
    isPermanentlyLost(current) ||
    current.status === 'not_submitted'
  )
    return entries;
  const next = update(current);
  if (next === current) return entries;
  const runs = [...entries.runs];
  runs[index] = next;
  return { ...entries, runs };
}

function createPending(inputId: MessageId): AgentRunPending {
  return {
    inputId,
    status: 'pending',
    ...NOT_ACCEPTED,
    placeholder: null,
    reply: '',
    turnId: null,
    changes: [],
    changeErrors: [],
  };
}

function baseOf(run: AgentRunBase): AgentRunBase {
  return {
    inputId: run.inputId,
    placeholder: run.placeholder,
    reply: run.reply,
    turnId: run.turnId,
    changes: run.changes,
    changeErrors: run.changeErrors,
  };
}

function acceptanceOf(run: AgentRunAccepted): AgentRunAccepted {
  return { runId: run.runId, disposition: run.disposition, ack: run.ack };
}

function toError(message: string, code: string | undefined): AgentRunError {
  return code === undefined ? { message } : { message, code };
}

function indexOfInput(entries: AgentRunEntries, inputId: MessageId): number {
  return entries.runs.findIndex((run) => run.inputId === inputId);
}

function isOpen(run: AgentRunState): boolean {
  return (
    run.status === 'pending' ||
    run.status === 'working' ||
    run.status === 'streaming'
  );
}

function isEnded(run: AgentRunState): boolean {
  return (
    run.status === 'finished' ||
    run.status === 'ignored' ||
    run.status === 'failed'
  );
}

function canProgress(run: AgentRunState): boolean {
  return isOpen(run) || isRecoverablyLost(run);
}

function isRecoverablyLost(run: AgentRunState): boolean {
  return (
    run.status === 'lost' &&
    (run.lostReason === 'stale_run' || run.lostReason === 'send_failed')
  );
}

function isPermanentlyLost(run: AgentRunState): boolean {
  return run.status === 'lost' && !isRecoverablyLost(run);
}

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
