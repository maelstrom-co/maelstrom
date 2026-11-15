import type {
  AgentConversationEvents,
  ConversationLostReason,
  MessageId,
  Orchestrator,
  SendMessageOptions,
} from '@maelstrom-co/client';

import {
  type AgentRunEvent,
  type AgentRunsSnapshot,
  EMPTY_AGENT_RUNS,
  reduceAgentRuns,
} from './agent-run-state.js';

/**
 * Agent Run state of one Orchestrator, kept current from its agent events and
 * shaped for `useSyncExternalStore`.
 */
export type AgentRunStore = {
  /**
   * Registers a listener called after each change of the snapshot. Returns a
   * function that removes it.
   */
  subscribe(listener: () => void): () => void;
  /** Returns the current snapshot, the same object until something changes. */
  getSnapshot(): AgentRunsSnapshot;
  /**
   * Sends text to the agent through the Orchestrator and registers the input
   * once it resolves. Rejections are rethrown and register nothing. A loss
   * never rejects it, because the input may have reached the agent. When the
   * conversation was lost while the send was in flight and the input is still
   * unknown when it resolves, the input is registered already lost: for good
   * after a disconnect or connector replacement, otherwise as a recoverable
   * `stale_run` loss that later events move on. After `dispose` the text is
   * still sent and the promise still resolves, but the input is no longer
   * registered in the snapshot.
   */
  sendMessage(text: string, options?: SendMessageOptions): Promise<MessageId>;
  /**
   * Stops following agent events and drops every listener. The snapshot stays
   * as it was. Calling it again does nothing.
   */
  dispose(): void;
};

/**
 * Creates an {@link AgentRunStore} that follows every agent event of the
 * Orchestrator from now on. Throws when the Orchestrator is already disposed,
 * because it rejects new subscriptions.
 */
export function createAgentRunStore(
  orchestrator: Pick<Orchestrator, 'agent' | 'sendMessage'>,
): AgentRunStore {
  let snapshot = EMPTY_AGENT_RUNS;
  let disposed = false;
  const listeners = new Set<() => void>();
  const inFlightSends = new Set<InFlightSend>();

  const dispatch = (event: AgentRunEvent): void => {
    if (disposed) return;
    if (event.type === 'conversation_lost') {
      for (const send of inFlightSends) {
        if (event.reason !== 'stale_run' || send.lostReason === null) {
          send.lostReason = event.reason;
        }
      }
    }
    const next = reduceAgentRuns(snapshot, event);
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const unsubscribes = AGENT_EVENT_TYPES.map((type) =>
    orchestrator.agent.on(type, dispatch),
  );

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    async sendMessage(text, options) {
      const send: InFlightSend = { lostReason: null };
      inFlightSends.add(send);
      try {
        const inputId = await orchestrator.sendMessage(text, options);
        dispatch(
          send.lostReason === null
            ? { type: 'input_sent', inputId }
            : { type: 'input_sent', inputId, lostReason: send.lostReason },
        );
        return inputId;
      } finally {
        inFlightSends.delete(send);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}

type InFlightSend = { lostReason: ConversationLostReason | null };

// The Record type makes a new client agent event fail to compile until the
// store subscribes to it.
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
