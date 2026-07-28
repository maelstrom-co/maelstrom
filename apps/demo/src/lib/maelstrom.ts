import { createMaelstrom } from '@maelstrom-co/react';
import {
  type CreateAdapterContext,
  maelstromRealtime,
} from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';
import { OpenAIAdapter } from '@maelstrom-co/realtime/openai';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { mapEntry } from '../vessels/map.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';
import { isDebugRequested } from './debug-mode';
import { isHosted } from './hosted-mode';
import { createBrowserMintToken, mintOpenAIToken } from './mint-token';
import { orchestrationLegibility } from './orchestration-legibility';
import { playgroundKeyStore } from './playground-key-store';
import { DEFAULT_REALTIME_MODEL } from './realtime-model';
import { getLivekitToken } from './voice/get-livekit-token';

const vessels = [
  calendarEntry,
  weatherEntry,
  journalEntry,
  tasksEntry,
  mapEntry,
] as const;

const hostedMintToken = createBrowserMintToken(
  () => playgroundKeyStore.state.apiKey,
  DEFAULT_REALTIME_MODEL,
);

export const m = createMaelstrom({
  vessels,
})
  .with(maelstromRealtime({ createAdapter, debug: isDebugRequested() }))
  .with(orchestrationLegibility);

// Provider is chosen at build time by VITE_VOICE_PROVIDER: `livekit` selects the
// cascaded LiveKit transport, anything else the speech-native
// OpenAI transport. Runs once per session, so per-session server resources (the
// token mint, the room name) are scoped by sessionId here.
//
// Hosted BYOK is OpenAI-only: the LiveKit path needs house-held server
// credentials (LIVEKIT_API_KEY/secret) and a running agent worker that a
// visitor's pasted OpenAI key can't reach, so the LiveKit branch is local-dev
// only. In hosted mode the browser mints directly from the visitor's key.
function createAdapter({
  sessionId,
}: CreateAdapterContext): RealtimeProviderAdapter {
  const hosted = isHosted();
  if (!hosted && import.meta.env.VITE_VOICE_PROVIDER === 'livekit') {
    return new LiveKitAdapter({
      mintToken: (roomName) => getLivekitToken({ data: { roomName } }),
      roomName: `maelstrom-${sessionId}`,
      vad: {
        assetBaseUrl: '/vad-web/',
        // Revisit this aggressive demo tuning with real app speech data before production reuse.
        providerOptions: {
          positiveSpeechThreshold: 0.8,
          negativeSpeechThreshold: 0.65,
          redemptionMs: 200,
          preSpeechPadMs: 100,
          minSpeechMs: 100,
        },
      },
      debug: isDebugRequested(),
    });
  }
  return new OpenAIAdapter({
    mintToken: hosted ? hostedMintToken : () => mintOpenAIToken(sessionId),
    debug: isDebugRequested(),
  });
}
