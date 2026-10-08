// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import { useEffect } from 'react';
import { registerAgentOrchestrator } from './agent-session-client';

export interface AgentSessionBridge {
  /** Lets agent.ui frames reach this Provider's orchestrator while mounted. */
  useAgentSessionBridge: () => void;
}

export const agentSessionBridge: MaelstromExtension<AgentSessionBridge> = (
  ctx: MaelstromExtensionContext,
) => ({
  useAgentSessionBridge: () => {
    const { orchestrator } = ctx.useMaelstromContext();
    useEffect(() => registerAgentOrchestrator(orchestrator), [orchestrator]);
  },
});
