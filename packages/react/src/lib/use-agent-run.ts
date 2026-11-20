import type {
  AgentMessageSubmission,
  AgentRunsSnapshot,
  SendMessageOptions,
} from '@maelstrom-co/client';
import { useStore } from '@tanstack/react-store';
import { useCallback, useMemo } from 'react';

import type { MaelstromContextPair } from './context.js';

/**
 * What `useAgentRun()` returns: the Agent Run snapshot plus a way to send input.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type UseAgentRunResult = AgentRunsSnapshot & {
  /**
   * Sends text to the agent through `Orchestrator.sendMessage` and returns
   * the input id and a `result` promise at once. The input appears in the
   * snapshot as `pending` before the frame is sent. `result` settles once
   * with the run state at that moment and never rejects, and a message that
   * never left the client settles `not_submitted`. A `lost` result may have
   * reached the agent, so do not resend it automatically. Keeps its identity
   * for the life of the Provider's Orchestrator.
   */
  readonly sendMessage: (
    text: string,
    options?: SendMessageOptions,
  ) => AgentMessageSubmission;
};

/**
 * Creates the `m.useAgentRun()` hook. It re-renders the component whenever the
 * Agent Run state of the Provider's Orchestrator changes.
 */
export function createUseAgentRun(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  return function useAgentRun(): UseAgentRunResult {
    const { orchestrator } = useMaelstromContext();
    const snapshot = useStore(orchestrator.agent.store, (state) => state);
    const sendMessage = useCallback(
      (text: string, options?: SendMessageOptions) =>
        orchestrator.sendMessage(text, options),
      [orchestrator],
    );

    return useMemo(
      () => ({ ...snapshot, sendMessage }),
      [snapshot, sendMessage],
    );
  };
}
