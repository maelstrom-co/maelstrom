import type { MessageId } from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';

import type { Logger } from '../utils/logger.js';
import type { EventSubscriber } from '../utils/typed-emitter.js';
import {
  AGENT_RUNS_CAP,
  type AgentRunEntries,
  type AgentRunError,
  type AgentRunEvent,
  type AgentRunsSnapshot,
  EMPTY_AGENT_RUN_ENTRIES,
  EMPTY_AGENT_RUNS,
  isSettled,
  reduceAgentRuns,
  reduceConversationLost,
  type SettledAgentRun,
} from './agent-run-state.js';
import type { AgentConversationEvents } from './conversation-event.types.js';

/**
 * Folds the agent events of one conversation into Agent Run state, published
 * through {@link AgentRunTracker.store}, and settles one result per sent input.
 */
export class AgentRunTracker {
  /** Agent Run state of the conversation, capped at the 20 latest inputs. */
  readonly store = new Store<AgentRunsSnapshot>(EMPTY_AGENT_RUNS);
  #entries: AgentRunEntries = EMPTY_AGENT_RUN_ENTRIES;
  readonly #openResults = new Map<MessageId, (run: SettledAgentRun) => void>();
  readonly #handingOff = new Set<MessageId>();
  readonly #logger: Pick<Logger, 'error'>;

  /**
   * Follows every event of `events` for the emitter's lifetime. The store
   * keeps its last state once the emitter is disposed. An error thrown by a
   * store subscriber is reported to `logger` and never reaches the caller of
   * a tracker method.
   */
  constructor(
    events: EventSubscriber<AgentConversationEvents>,
    logger: Pick<Logger, 'error'>,
  ) {
    this.#logger = logger;
    for (const type of AGENT_EVENT_TYPES)
      events.on(type, (event) => this.#dispatch(event));
  }

  /**
   * Returns the promise of the settled state of `inputId`, which settles once
   * {@link sending}, {@link notSubmitted} or later events settle the input.
   */
  track(inputId: MessageId): Promise<SettledAgentRun> {
    return new Promise<SettledAgentRun>((resolve) => {
      this.#openResults.set(inputId, resolve);
    });
  }

  /**
   * Registers the input as pending. Call it right before the input is handed
   * to the connector, so events that arrive before the send resolves find it.
   *
   * Store subscribers run during this call and may end the conversation. A
   * `conversation_lost` reported before the call returns leaves the input
   * pending, because it was not handed to the connector yet. The caller must
   * then skip the send and report the input through {@link notSubmitted}.
   */
  sending(inputId: MessageId): void {
    this.#handingOff.add(inputId);
    try {
      this.#dispatch({ type: 'input_sent', inputId });
    } finally {
      this.#handingOff.delete(inputId);
    }
  }

  /** Records that the input never left the client. */
  notSubmitted(inputId: MessageId, error: AgentRunError): void {
    this.#dispatch({ type: 'input_not_submitted', inputId, error });
  }

  /** Records that the transport refused the input frame. */
  sendFailed(inputId: MessageId): void {
    this.#dispatch({ type: 'input_send_failed', inputId });
  }

  #dispatch(event: AgentRunEvent): void {
    const next =
      event.type === 'conversation_lost'
        ? reduceConversationLost(this.#entries, event, this.#handingOff)
        : reduceAgentRuns(this.#entries, event);
    if (next === this.#entries) return;
    this.#settleResults(next);
    this.#entries = prune(next, this.#openResults);
    this.#publish();
  }

  #settleResults(entries: AgentRunEntries): void {
    if (this.#openResults.size === 0) return;
    for (const run of entries.runs) {
      const resolve = this.#openResults.get(run.inputId);
      if (resolve === undefined || !isSettled(run)) continue;
      this.#openResults.delete(run.inputId);
      resolve(run);
    }
  }

  #publish(): void {
    const previous = this.store.state;
    const runs = this.#entries.runs.slice(-AGENT_RUNS_CAP);
    const sameRuns =
      runs.length === previous.runs.length &&
      runs.every((run, index) => run === previous.runs[index]);
    if (sameRuns && this.#entries.error === previous.error) return;
    // The store takes the new state before it notifies, so a subscriber that
    // throws leaves the state applied and only its error has to be contained.
    try {
      this.store.setState(() => ({
        run: runs[runs.length - 1] ?? null,
        runs: sameRuns ? previous.runs : runs,
        error: this.#entries.error,
      }));
    } catch (error) {
      this.#logger.error('Agent run store subscriber threw', error);
    }
  }
}

// Runs beyond the cap stay tracked only while their result is still open.
function prune(
  entries: AgentRunEntries,
  openResults: ReadonlyMap<MessageId, unknown>,
): AgentRunEntries {
  const evictable = entries.runs.length - AGENT_RUNS_CAP;
  if (evictable <= 0) return entries;
  const runs = entries.runs.filter(
    (run, index) => index >= evictable || openResults.has(run.inputId),
  );
  return runs.length === entries.runs.length ? entries : { ...entries, runs };
}

// The Record type makes a new client agent event fail to compile until the
// tracker subscribes to it.
const AGENT_EVENT_PRESENCE: Record<keyof AgentConversationEvents, true> = {
  accepted: true,
  ui_change: true,
  placeholder: true,
  message: true,
  finished: true,
  error: true,
  conversation_lost: true,
};

const AGENT_EVENT_TYPES = Object.keys(
  AGENT_EVENT_PRESENCE,
) as (keyof AgentConversationEvents)[];
