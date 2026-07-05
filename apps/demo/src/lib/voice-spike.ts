import { useEffect, useState } from 'react';
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
 * Demo spike: wires the OpenAI realtime voice loop to this demo's Orchestrator
 * via `RealtimeSession`. Throwaway wiring for live validation, not the eventual
 * framework-binding package.
 */
export function voiceSpike(): MaelstromExtension<{
  useVoiceSpike: () => VoiceSpikeApi;
}> {
  return (ctx) => ({
    useVoiceSpike: () => {
      const { orchestrator } = ctx.useMaelstromContext();
      const [state, setState] = useState<VoiceSessionState>('idle');

      // Created exactly once via a lazy initializer. RealtimeSession owns
      // mutable connection state and subscriptions, so it must be a stable
      // instance across renders — useMemo's cache is not guaranteed to persist.
      const [session] = useState(() => {
        const bridge: RealtimeInstance = {
          submitIntent: (intent) =>
            orchestrator.processIntent(intent).then(() => {}),
          waitForIdle: () => orchestrator.commandProcessor.waitForIdle(),
          getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
          onSettled: (cb) => orchestrator.onSettled(cb),
        };

        // Spike wiring: enable realtime tracing for live validation. The
        // package gates these logs behind this flag; this turns them on for
        // the realtime path only, independent of the instance's global debug.
        const debug = true;

        const adapter = createOpenAiAdapter({
          mintToken: () => mintOpenAiToken(orchestrator.getConfig().sessionId),
          debug,
        });

        return new RealtimeSession({
          adapter,
          instance: bridge,
          sessionId: orchestrator.getConfig().sessionId,
          debug,
          onEvent: (event: SidechannelEvent) => {
            // Latency/timing sidechannel — read this during live validation.
            console.table([event]);
          },
        });
      });

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
