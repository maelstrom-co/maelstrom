import type { SessionId } from '@maelstrom-co/protocol';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import { OpenAIAdapter } from '@maelstrom-co/realtime-openai';
import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { isDebugRequested } from './debug-mode';
import {
  createHostedDemoGreetingSynthesizer,
  createLocalDemoGreetingSynthesizer,
  DEMO_OPENAI_VOICE,
} from './demo-greeting-tts';
import { isHosted, usesBrowserKey } from './hosted-mode';
import { HOSTED_VAD_MODEL } from './hosted-vad';
import { createDemoLiveExchange } from './live-exchange';
import { createBrowserMintToken, mintOpenAIToken } from './mint-token';
import { playgroundKeyStore } from './playground-key-store';
import { DEFAULT_REALTIME_MODEL } from './realtime-model';
import { getLivekitToken } from './voice/get-livekit-token';
import {
  type DemoVoiceProvider,
  LIVE_BACKEND_MODEL,
  LIVE_MODEL,
  voiceProviderStore,
} from './voice-provider';

// Factories only. No network at module load.
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

export function createAdapter(
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
    model: LIVE_MODEL,
    playbackBargeIn: { providerOptions: { model: HOSTED_VAD_MODEL } },
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
    playbackBargeIn: { providerOptions: { model: HOSTED_VAD_MODEL } },
    ...(hosted
      ? {
          serverVad: {
            threshold: 0.8,
            bargeInMode: 'immediate',
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
