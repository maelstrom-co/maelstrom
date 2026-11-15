import type { AgentConversationEvents } from '@maelstrom-co/client';
import { useEffect } from 'react';

import type { MaelstromContextPair } from './context.js';
import { useLatestRef } from './use-latest-ref.js';

/**
 * Creates the `m.useAgentEvent()` hook. It subscribes a handler to one raw
 * agent event of the Provider's Orchestrator for the life of the component.
 */
export function createUseAgentEvent(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  return function useAgentEvent<K extends keyof AgentConversationEvents>(
    type: K,
    handler: (event: AgentConversationEvents[K]) => void,
  ): void {
    const { orchestrator } = useMaelstromContext();
    const handlerRef = useLatestRef(handler);

    useEffect(
      () =>
        orchestrator.agent.on(type, (event) => {
          handlerRef.current(event);
        }),
      [orchestrator, type, handlerRef],
    );
  };
}
