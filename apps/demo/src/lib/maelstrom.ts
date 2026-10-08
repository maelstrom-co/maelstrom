import type { SessionId } from '@maelstrom-co/protocol';
import { createMaelstrom } from '@maelstrom-co/react';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import { OpenAIAdapter } from '@maelstrom-co/realtime-openai';
import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { calendarEntry } from '../vessels/calendar.vessel';
import { cartEntry } from '../vessels/cart.vessel';
import { catalogEntry } from '../vessels/catalog.vessel';
import { checkoutEntry } from '../vessels/checkout.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { mapEntry } from '../vessels/map.vessel';
import { ordersEntry } from '../vessels/orders.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';
import { isDebugRequested } from './debug-mode';
import {
  createHostedDemoGreetingSynthesizer,
  createLocalDemoGreetingSynthesizer,
  DEMO_GREETING,
  DEMO_OPENAI_VOICE,
} from './demo-greeting-tts';
import { attachDemoVoice, demoVoiceOpening } from './demo-voice';
import { createDiagnosticPeer } from './diagnostic-capture';
import { isHosted, usesBrowserKey } from './hosted-mode';
import { HOSTED_VAD_MODEL } from './hosted-vad';
import { createDemoLiveExchange } from './live-exchange';
import { createBrowserMintToken, mintOpenAIToken } from './mint-token';
import { orchestrationLegibility } from './orchestration-legibility';
import { playgroundKeyStore } from './playground-key-store';
import { DEFAULT_REALTIME_MODEL } from './realtime-model';
import { getLivekitToken } from './voice/get-livekit-token';
import {
  DEMO_VOICE_PROVIDERS,
  type DemoVoiceProvider,
  LIVE_BACKEND_MODEL,
  LIVE_MODEL,
  voiceProviderStore,
} from './voice-provider';

export { DEMO_GREETING, DEMO_OPENAI_VOICE };

const vessels = [
  calendarEntry,
  weatherEntry,
  journalEntry,
  tasksEntry,
  mapEntry,
  ordersEntry,
  catalogEntry,
  cartEntry,
  checkoutEntry,
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
let preparedProvider: DemoVoiceProvider | undefined;

/** Unlocks the next browser-key Realtime adapter inside the current user gesture. Live waits for playback acceptance after connecting. */
export function prepareBrowserOpenAIVoice(): boolean {
  const provider = voiceProviderStore.state.provider;
  if (!usesBrowserKey() || provider !== 'realtime') return false;
  if (preparedProvider !== provider) preparedBrowserOpenAIAdapter = undefined;
  preparedProvider = provider;
  preparedBrowserOpenAIAdapter ??= createOpenAIAdapter(hostedMintToken);
  void Promise.resolve(preparedBrowserOpenAIAdapter.activateAudio()).catch(
    () => {},
  );
  return true;
}

export const m = createMaelstrom({
  vessels,
})
  .with(
    maelstromRealtime({
      providers: DEMO_VOICE_PROVIDERS,
      initialProvider: () => voiceProviderStore.state.provider,
      createAdapter: ({ provider, sessionId }) =>
        createAdapter(provider, sessionId),
      opening: demoVoiceOpening(DEMO_GREETING),
      onSession: attachDemoVoice,
    }),
  )
  .with(orchestrationLegibility);

function createAdapter(
  provider: DemoVoiceProvider,
  sessionId: SessionId,
): RealtimeProviderAdapter {
  const browserKeyMode = usesBrowserKey();
  if (provider === 'livekit') {
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
  if (
    browserKeyMode &&
    preparedBrowserOpenAIAdapter &&
    preparedProvider === provider
  ) {
    const adapter = preparedBrowserOpenAIAdapter;
    preparedBrowserOpenAIAdapter = undefined;
    return adapter;
  }
  if (provider === 'live') return createLiveAdapter();
  return createOpenAIAdapter(
    browserKeyMode ? hostedMintToken : () => mintOpenAIToken(sessionId),
  );
}

function createLiveAdapter(): OpenAILiveAdapter {
  return new OpenAILiveAdapter({
    createPeer: createDiagnosticPeer,
    model: LIVE_MODEL,
    responses: { model: LIVE_BACKEND_MODEL },
    exchange: createDemoLiveExchange(
      usesBrowserKey() ? () => playgroundKeyStore.state.apiKey : undefined,
    ),
  });
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
