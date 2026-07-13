import { useEffect, useState } from 'react';
import type { MaelstromExtension } from '@maelstrom-co/react';
import type { Orchestrator, VoiceSessionState } from '@maelstrom-co/client';
import {
  RealtimeSession,
  type RealtimeInstance,
} from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import type { SidechannelEvent } from '@maelstrom-co/protocol';
import { getLivekitToken } from './voice/get-livekit-token';

export interface LiveKitVoiceSpikeApi {
  readonly state: VoiceSessionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Hold-to-talk: unmute the mic and start a turn. */
  startTalking(): Promise<void>;
  /** Hold-to-talk: end the turn (flush STT) and mute the mic. */
  stopTalking(): Promise<void>;
}

// The concrete adapter is held alongside the session because startTalking /
// stopTalking are LiveKit-only methods that don't exist on the provider-neutral
// RealtimeSession — the demo drives push-to-talk through them directly.
interface LiveKitSpikeHandle {
  readonly session: RealtimeSession;
  readonly adapter: LiveKitAdapter;
}

function createHandle(orchestrator: Orchestrator): LiveKitSpikeHandle {
  const bridge: RealtimeInstance = {
    submitIntent: (intent) => orchestrator.processIntent(intent).then(() => {}),
    waitForIdle: () => orchestrator.commandProcessor.waitForIdle(),
    getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
    getCapabilitySnapshot: () => orchestrator.getCapabilitySnapshot(),
    onSettled: (cb) => orchestrator.onSettled(cb),
  };

  const debug = true;
  const sessionId = orchestrator.getConfig().sessionId;

  const adapter = new LiveKitAdapter({
    getToken: (roomName) => getLivekitToken({ data: { roomName } }),
    roomName: `maelstrom-${sessionId}`,
    debug,
  });

  const session = new RealtimeSession({
    adapter,
    instance: bridge,
    sessionId,
    debug,
    onEvent: (event: SidechannelEvent) => {
      console.table([event]);
    },
  });

  return { session, adapter };
}

/**
 * Demo spike: wires the LiveKit cascaded voice loop to this demo's Orchestrator
 * via the same `RealtimeSession` core the OpenAI spike uses — only the adapter
 * differs. Throwaway wiring for live validation, not the eventual
 * framework-binding package.
 */
export function liveKitVoiceSpike(): MaelstromExtension<{
  useLiveKitVoiceSpike: () => LiveKitVoiceSpikeApi;
}> {
  // Same idempotency shape as `voiceSpike`: the factory runs once outside
  // React, so the session is built lazily in the hook and shared per
  // orchestrator (keyed on the instance), with a refcount so a StrictMode
  // remount doesn't tear down a session still in use.
  const handles = new WeakMap<Orchestrator, LiveKitSpikeHandle>();
  const refCounts = new WeakMap<Orchestrator, number>();

  function getOrCreateHandle(orchestrator: Orchestrator): LiveKitSpikeHandle {
    const existing = handles.get(orchestrator);
    if (existing) return existing;
    const handle = createHandle(orchestrator);
    handles.set(orchestrator, handle);
    return handle;
  }

  return (ctx) => ({
    useLiveKitVoiceSpike: () => {
      const { orchestrator } = ctx.useMaelstromContext();
      const { session, adapter } = getOrCreateHandle(orchestrator);

      const [state, setState] = useState<VoiceSessionState>(session.state);

      useEffect(() => {
        return session.on('state', setState);
      }, [session]);

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
        startTalking: () => adapter.startTalking(),
        stopTalking: () => adapter.stopTalking(),
      };
    },
  });
}
