import { createMaelstrom } from '@maelstrom-co/react';
import {
  type CreateAdapterContext,
  maelstromRealtime,
} from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import { OpenAIAdapter } from '@maelstrom-co/realtime-openai';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { mapEntry } from '../vessels/map.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';
import { isDebugRequested } from './debug-mode';
import {
  createHostedDemoGreetingSynthesizer,
  createLocalDemoGreetingSynthesizer,
  DEMO_GREETING,
  DEMO_OPENAI_VOICE,
} from './demo-greeting-tts';
import {
  isHosted,
  usesBrowserKey,
  usesBrowserOpenAIVoice,
  usesOpenAIVoice,
} from './hosted-mode';
import { HOSTED_VAD_MODEL } from './hosted-vad';
import { createBrowserMintToken, mintOpenAIToken } from './mint-token';
import { orchestrationLegibility } from './orchestration-legibility';
import { playgroundKeyStore } from './playground-key-store';
import { DEFAULT_REALTIME_MODEL } from './realtime-model';
import { getLivekitToken } from './voice/get-livekit-token';

export { DEMO_GREETING, DEMO_OPENAI_VOICE };

const vessels = [
  calendarEntry,
  weatherEntry,
  journalEntry,
  tasksEntry,
  mapEntry,
] as const;

// Factories only — no network at module load.
const localSynthesizeGreeting = createLocalDemoGreetingSynthesizer();
const hostedSynthesizeGreeting = createHostedDemoGreetingSynthesizer(
  () => playgroundKeyStore.state.apiKey,
);

const hostedMintToken = createBrowserMintToken(
  () => playgroundKeyStore.state.apiKey,
  DEFAULT_REALTIME_MODEL,
  DEMO_OPENAI_VOICE,
);

let preparedBrowserOpenAIAdapter: OpenAIAdapter | undefined;

/** Unlocks the next browser-key OpenAI adapter inside the current user gesture. */
export function prepareBrowserOpenAIVoice(): boolean {
  if (!usesBrowserOpenAIVoice()) return false;
  preparedBrowserOpenAIAdapter ??= createOpenAIAdapter(hostedMintToken);
  preparedBrowserOpenAIAdapter.activateAudio();
  return true;
}

export const m = createMaelstrom({
  vessels,
})
  .with(
    maelstromRealtime({
      createAdapter,
      debug: isDebugRequested(),
      greeting: { text: DEMO_GREETING },
    }),
  )
  .with(orchestrationLegibility);

// Provider is chosen at build time by VITE_VOICE_PROVIDER: `livekit` selects the
// cascaded LiveKit transport, anything else the speech-native
// OpenAI transport. Runs once per session, so per-session server resources (the
// token mint, the room name) are scoped by sessionId here.
//
// Hosted BYOK is OpenAI-only: the LiveKit path needs house-held server
// credentials (LIVEKIT_API_KEY/secret) and a running agent worker that a
// visitor's pasted OpenAI key can't reach, so the LiveKit branch is local-dev
// only. In hosted mode the browser mints and synthesizes the greeting directly
// with the visitor's key.
function createAdapter({
  sessionId,
}: CreateAdapterContext): RealtimeProviderAdapter {
  const browserKeyMode = usesBrowserKey();
  if (!usesOpenAIVoice()) {
    return new LiveKitAdapter({
      mintToken: (roomName, context) =>
        getLivekitToken({
          data: { roomName, ...(context?.trigger ? { trigger: true } : {}) },
        }),
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
  if (browserKeyMode && preparedBrowserOpenAIAdapter) {
    const adapter = preparedBrowserOpenAIAdapter;
    preparedBrowserOpenAIAdapter = undefined;
    return adapter;
  }
  return createOpenAIAdapter(
    browserKeyMode ? hostedMintToken : () => mintOpenAIToken(sessionId),
  );
}

function createOpenAIAdapter(
  mintToken: ConstructorParameters<typeof OpenAIAdapter>[0]['mintToken'],
): OpenAIAdapter {
  const hosted = isHosted();
  const browserKeyMode = usesBrowserKey();
  return new OpenAIAdapter({
    mintToken,
    ...(hosted
      ? {
          serverVad: {
            threshold: 0.8,
            bargeInMode: 'transcript-confirmed',
          },
        }
      : {}),
    voice: DEMO_OPENAI_VOICE,
    transcription: { model: 'gpt-4o-transcribe' },
    synthesizeGreeting: browserKeyMode
      ? hostedSynthesizeGreeting
      : localSynthesizeGreeting,
    greetingInterruption: hosted
      ? { providerOptions: { model: HOSTED_VAD_MODEL } }
      : true,
    debug: isDebugRequested(),
  });
}
