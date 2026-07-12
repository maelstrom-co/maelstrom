import { useEffect, useState } from 'react';
import type { MaelstromExtension } from '@maelstrom-co/react';
import type { Orchestrator, VoiceSessionState } from '@maelstrom-co/client';
import {
  RealtimeSession,
  type RealtimeInstance,
} from '@maelstrom-co/realtime';
import { OpenAIAdapter } from '@maelstrom-co/realtime/openai';
import type { SidechannelEvent } from '@maelstrom-co/protocol';
import { mintOpenAIToken } from './mint-token';

export interface VoiceSpikeApi {
  readonly state: VoiceSessionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

function createSession(orchestrator: Orchestrator): RealtimeSession {
  const bridge: RealtimeInstance = {
    submitIntent: (intent) =>
      orchestrator.processIntent(intent).then(() => {}),
    waitForIdle: () => orchestrator.commandProcessor.waitForIdle(),
    getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
    getCapabilitySnapshot: () => orchestrator.getCapabilitySnapshot(),
    onSettled: (cb) => orchestrator.onSettled(cb),
  };

  // Spike wiring: enable realtime tracing for live validation. The package
  // gates these logs behind this flag; this turns them on for the realtime
  // path only, independent of the instance's global debug.
  const debug = true;

  const adapter = new OpenAIAdapter({
    mintToken: () => mintOpenAIToken(orchestrator.getConfig().sessionId),
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
}

/**
 * Demo spike: wires the OpenAI realtime voice loop to this demo's Orchestrator
 * via `RealtimeSession`. Throwaway wiring for live validation, not the eventual
 * framework-binding package.
 */
export function voiceSpike(): MaelstromExtension<{
  useVoiceSpike: () => VoiceSpikeApi;
}> {
  // The extension factory runs once, outside React, before any component
  // renders, and the only handle it gets on the orchestrator is the
  // `useMaelstromContext` hook — so the session can't be built here. Instead
  // this map makes the *hook* idempotent: whichever call reaches it first
  // (including a StrictMode remount) creates the session, and every other
  // caller for the same orchestrator reuses it. Keyed on the orchestrator
  // instance (stable for the life of the Provider) rather than a module-level
  // singleton so multiple Maelstrom instances don't share a voice session.
  const sessions = new WeakMap<Orchestrator, RealtimeSession>();
  const refCounts = new WeakMap<Orchestrator, number>();

  function getOrCreateSession(orchestrator: Orchestrator): RealtimeSession {
    const existing = sessions.get(orchestrator);
    if (existing) return existing;
    const session = createSession(orchestrator);
    sessions.set(orchestrator, session);
    return session;
  }

  return (ctx) => ({
    useVoiceSpike: () => {
      const { orchestrator } = ctx.useMaelstromContext();
      const session = getOrCreateSession(orchestrator);

      // Seeded from the session's current state rather than a hardcoded
      // 'idle' — a subscriber mounting after another one already
      // connected the shared session must not render a stale status.
      const [state, setState] = useState<VoiceSessionState>(session.state);

      useEffect(() => {
        return session.on('state', setState);
      }, [session]);

      // Refcounted so a StrictMode fake-unmount (or any other subscriber
      // still holding the hook) doesn't tear down a session that's still in
      // use — only the last subscriber to unmount disconnects it. The map
      // entry is left in place (not deleted) so a later remount or another
      // component still gets this same instance rather than a fresh one.
      useEffect(() => {
        const count = (refCounts.get(orchestrator) ?? 0) + 1;
        refCounts.set(orchestrator, count);
        return () => {
          const remaining = (refCounts.get(orchestrator) ?? 1) - 1;
          refCounts.set(orchestrator, remaining);
          if (remaining <= 0) {
            void session.disconnect();
          }
        };
      }, [orchestrator, session]);

      return {
        state,
        connect: () => session.connect(),
        disconnect: () => session.disconnect(),
      };
    },
  });
}
