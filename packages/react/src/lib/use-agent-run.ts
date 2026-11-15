import type { MessageId, SendMessageOptions } from '@maelstrom-co/client';
import { useMemo, useSyncExternalStore } from 'react';

import type { AgentRunsSnapshot } from './agent-run-state.js';
import type { MaelstromContextPair } from './context.js';

/** What `useAgentRun()` returns: the Agent Run snapshot plus a way to send input. */
export type UseAgentRunResult = {
  /** The run of the most recently registered input, or null before any input. */
  readonly run: AgentRunsSnapshot['run'];
  /** Known runs, oldest first, capped at the most recent 20. */
  readonly runs: AgentRunsSnapshot['runs'];
  /**
   * The latest failure not tied to any input or run. Cleared when the next
   * input is sent.
   */
  readonly error: AgentRunsSnapshot['error'];
  /**
   * Sends text to the agent and resolves to the input id that its events carry.
   * Keeps its identity for the life of the Provider. Rejects when the
   * Orchestrator is disposed, not connected, or its connector cannot carry
   * agent inputs, and a rejected send registers no run.
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
      () => ({
        run: snapshot.run,
        runs: snapshot.runs,
        error: snapshot.error,
        sendMessage,
      }),
      [snapshot, sendMessage],
    );
  };
}
