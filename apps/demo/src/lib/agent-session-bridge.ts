// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
import type { Orchestrator } from '@maelstrom-co/client';
import type { MaelstromResponse } from '@maelstrom-co/protocol';
import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import { useEffect } from 'react';
import {
  registerAgentOrchestrator,
  runAgentTurn,
} from './agent-session-client';
import { createVoiceCueGate } from './agent-voice-cues';
import { currentVoiceSession } from './demo-voice';

export interface AgentSessionBridge {
  /**
   * Lets agent.ui frames reach this Provider's orchestrator while mounted,
   * and routes its `processIntent` (voice's `update_ui` path) into the
   * Agent Session instead of a direct Planner request.
   */
  useAgentSessionBridge: () => void;
}

export const agentSessionBridge: MaelstromExtension<AgentSessionBridge> = (
  ctx: MaelstromExtensionContext,
) => ({
  useAgentSessionBridge: () => {
    const { orchestrator } = ctx.useMaelstromContext();
    useEffect(() => {
      const unregister = registerAgentOrchestrator(orchestrator);
      const restore = routeProcessIntentToAgentSession(orchestrator);
      return () => {
        restore();
        unregister();
      };
    }, [orchestrator]);
  },
});

// The realtime bridge in @maelstrom-co/react-realtime answers update_ui with
// `orchestrator.processIntent(intent).userMessage`, looked up per call, so an
// own-property override on this one orchestrator reroutes /shop voice without
// a package change. Only `userMessage` is read; the rest keeps the type whole.
function routeProcessIntentToAgentSession(
  orchestrator: Orchestrator,
): () => void {
  const original = orchestrator.processIntent;
  orchestrator.processIntent = async (intent: string) => {
    const cues = createVoiceCueGate({
      speak: (text) =>
        currentVoiceSession(orchestrator)?.speakCue(text) ?? false,
      log: (message, text) => console.info(`[agent-session] ${message}:`, text),
    });
    const outcome = await runAgentTurn(intent, {
      onProgress: (text) => cues.offer(text),
    }).finally(() => cues.close());
    const layout = orchestrator.commandProcessor.store.state.layout;
    return {
      type: 'maelstrom_response',
      requestId: `agent-${crypto.randomUUID()}`,
      userMessage: outcome.reply,
      rationale: 'Agent Session turn',
      executionPlan: [],
      layout,
    } as unknown as MaelstromResponse;
  };
  return () => {
    orchestrator.processIntent = original;
  };
}
