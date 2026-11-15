import type { MessageId, SendMessageOptions } from '@maelstrom-co/client';
import { useMemo, useSyncExternalStore } from 'react';

import type { AgentRunsSnapshot } from './agent-run-state.js';
import type { MaelstromContextPair } from './context.js';

/** What `useAgentRun()` returns: the Agent Run snapshot plus a way to send input. */
export type UseAgentRunResult = AgentRunsSnapshot & {
  /**
   * Sends text to the agent and resolves to the input id that its events carry.
   * Keeps its identity for the life of the Provider. Rejects as
   * `Orchestrator.sendMessage` does: when the Orchestrator is disposed or not
   * connected, when its connector cannot carry agent inputs, or with the
   * connector's own error when the transport refused the frame. After a
   * transport refusal the agent may still have received the text, so do not
   * resend it automatically. A rejected send does not register a run itself,
   * but agent events for the input can still register one.
   */
  readonly sendMessage: (
    text: string,
    options?: SendMessageOptions,
  ) => Promise<MessageId>;
};

/**
 * Creates the `m.useAgentRun()` hook. It re-renders the component whenever the
 * Agent Run state of the Provider's Orchestrator changes.
 */
export function createUseAgentRun(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  return function useAgentRun(): UseAgentRunResult {
    const { agentRunStore } = useMaelstromContext();
    const snapshot = useSyncExternalStore(
      agentRunStore.subscribe,
      agentRunStore.getSnapshot,
      agentRunStore.getSnapshot,
    );
    const sendMessage = agentRunStore.sendMessage;

    return useMemo(
      () => ({ ...snapshot, sendMessage }),
      [snapshot, sendMessage],
    );
  };
}
