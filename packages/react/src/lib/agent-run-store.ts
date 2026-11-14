import type {
  AgentConversationEvents,
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
   * once it resolves. Rejections are rethrown and register nothing.
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
 * Orchestrator from now on. Dispose it before the Orchestrator, which rejects
 * new subscriptions once disposed.
 */
export function createAgentRunStore(
  orchestrator: Pick<Orchestrator, 'agent' | 'sendMessage'>,
): AgentRunStore {
  let snapshot = EMPTY_AGENT_RUNS;
  let disposed = false;
  const listeners = new Set<() => void>();

  const dispatch = (event: AgentRunEvent): void => {
    if (disposed) return;
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
      const inputId = await orchestrator.sendMessage(text, options);
      dispatch({ type: 'input_sent', inputId });
      return inputId;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}

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
