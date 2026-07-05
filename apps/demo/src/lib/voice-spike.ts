import { useEffect, useMemo, useState } from 'react';
import type { MaelstromExtension } from '@maelstrom-co/react';
import type { VoiceSessionState } from '@maelstrom-co/client';
import {
  RealtimeSession,
  type RealtimeInstance,
} from '@maelstrom-co/realtime';
import { createOpenAiAdapter } from '@maelstrom-co/realtime/openai';
import type { SidechannelEvent } from '@maelstrom-co/protocol';
import { mintOpenAiToken } from './mint-token';

export interface VoiceSpikeApi {
  readonly state: VoiceSessionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * MAE-300 Task 9 demo spike: wires the OpenAI realtime voice loop to this
 * demo's Orchestrator via `RealtimeSession`. This is throwaway wiring for
 * live validation, not the eventual `@maelstrom-co/react-realtime` package
 * (deferred — see MAE-300).
 */
export function voiceSpike(): MaelstromExtension<{
  useVoiceSpike: () => VoiceSpikeApi;
}> {
  return (ctx) => ({
    useVoiceSpike: () => {
      const { orchestrator } = ctx.useMaelstromContext();
      const [state, setState] = useState<VoiceSessionState>('idle');

      const session = useMemo(() => {
        const bridge: RealtimeInstance = {
          submitIntent: (intent) =>
            orchestrator.processIntent(intent).then(() => {}),
          waitForIdle: () => orchestrator.commandProcessor.waitForIdle(),
          getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
          onSettled: (cb) => orchestrator.onSettled(cb),
        };

        const adapter = createOpenAiAdapter({
          mintToken: () => mintOpenAiToken(orchestrator.getConfig().sessionId),
        });

        return new RealtimeSession({
          adapter,
          instance: bridge,
          sessionId: orchestrator.getConfig().sessionId,
          onEvent: (event: SidechannelEvent) => {
            // Latency/timing sidechannel — read this during live validation.
            console.table([event]);
          },
        });
      }, [orchestrator]);

      useEffect(() => {
        return session.on('state', setState);
      }, [session]);

      // Best-effort teardown if the component unmounts mid-session; the mic
      // toggle is the primary disconnect path.
      useEffect(() => {
        return () => {
          void session.disconnect();
        };
      }, [session]);

      return {
        state,
        connect: () => session.connect(),
        disconnect: () => session.disconnect(),
      };
    },
  });
}
