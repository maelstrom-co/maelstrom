import type { AgentConversationEvents } from '@maelstrom-co/client';
import { useEffect, useLayoutEffect, useRef } from 'react';

import type { MaelstromContextPair } from './context.js';

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
    const committedRef = useRef({ type, handler });

    useLayoutEffect(() => {
      committedRef.current = { type, handler };
    });

    useEffect(
      () =>
        orchestrator.agent.events.on(type, (event) => {
          if (committedRef.current.type !== type) return;
          return committedRef.current.handler(event);
        }),
      [orchestrator, type],
    );
  };
}
