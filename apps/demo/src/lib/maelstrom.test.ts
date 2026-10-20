import type { DevtoolsOptions } from '@maelstrom-co/devtools';
import { SessionId } from '@maelstrom-co/protocol';
import type {
  MaelstromRealtimeBaseOptions,
  MaelstromRealtimeOpeningOptions,
} from '@maelstrom-co/react-realtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeValidWavBytes } from './__tests__/wav-fixtures';
import {
  DEMO_GREETING,
  DEMO_GREETING_TTS_ROUTE,
  DEMO_GREETING_TTS_URL,
  DEMO_OPENAI_VOICE,
} from './demo-greeting-tts';
import { prepareBrowserOpenAIVoice } from './demo-realtime';
import { registerDemoVoice } from './demo-voice';
import { clearPlaygroundKey, setPlaygroundKey } from './playground-key-store';
import type { DemoVoiceProvider } from './voice-provider';
import { selectVoiceProvider } from './voice-provider';

type DemoRealtimeOptions = MaelstromRealtimeBaseOptions<DemoVoiceProvider> &
  MaelstromRealtimeOpeningOptions<DemoVoiceProvider>;

const state = vi.hoisted(() => ({
  extension: {},
  orchestrationExtension: {},
  devtoolsExtension: {},
  devtoolsOptions: undefined as DevtoolsOptions | undefined,
  installedExtensions: [] as unknown[],
  realtimeOptions: undefined as DemoRealtimeOptions | undefined,
  liveKitAdapterOptions: [] as unknown[],
  openAIAdapterOptions: [] as unknown[],
  liveAdapterOptions: [] as unknown[],
  openAIAdapterInstances: [] as Array<{ activateAudioCalls: number }>,
}));

vi.mock('@maelstrom-co/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/react')>()),
  createMaelstrom: () => {
    const maelstrom = {
      with: (candidate: unknown) => {
        state.installedExtensions.push(candidate);
        return maelstrom;
      },
    };
    return maelstrom;
  },
}));
vi.mock('@maelstrom-co/react-realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/react-realtime')>()),
  maelstromRealtime: (options: DemoRealtimeOptions) => {
    state.realtimeOptions = options;
    return state.extension;
  },
}));
vi.mock('@maelstrom-co/realtime-openai-live', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@maelstrom-co/realtime-openai-live')
  >()),
  OpenAILiveAdapter: class {
    constructor(options: unknown) {
      state.liveAdapterOptions.push(options);
    }
  },
}));
vi.mock('@maelstrom-co/realtime-openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime-openai')>()),
  OpenAIAdapter: class {
    activateAudioCalls = 0;
    constructor(options: unknown) {
      state.openAIAdapterOptions.push(options);
      state.openAIAdapterInstances.push(this);
    }
    activateAudio() {
      this.activateAudioCalls += 1;
    }
  },
}));
vi.mock('@maelstrom-co/realtime-livekit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime-livekit')>()),
  LiveKitAdapter: class {
    constructor(options: unknown) {
      state.liveKitAdapterOptions.push(options);
    }
  },
}));
vi.mock('../vessels/calendar.vessel', () => ({ calendarEntry: {} }));
vi.mock('../vessels/journal.vessel', () => ({ journalEntry: {} }));
vi.mock('../vessels/map.vessel', () => ({ mapEntry: {} }));
vi.mock('../vessels/tasks.vessel', () => ({ tasksEntry: {} }));
vi.mock('../vessels/weather.vessel', () => ({ weatherEntry: {} }));
vi.mock('./debug-mode', () => ({ isDebugRequested: () => true }));
vi.mock('./mint-token', () => ({
  mintOpenAIToken: () => Promise.resolve(),
  createBrowserMintToken: () => async () => {
    throw new Error('createBrowserMintToken should not be called in tests');
  },
}));
vi.mock('./orchestration-legibility', () => ({
  orchestrationLegibility: state.orchestrationExtension,
}));
vi.mock('@maelstrom-co/react-devtools/production', () => ({
  devtools: (options: DevtoolsOptions) => {
    state.devtoolsOptions = options;
    return state.devtoolsExtension;
  },
}));
vi.mock('./voice/get-livekit-token', () => ({
  getLivekitToken: () => Promise.resolve(),
}));

// Static import of maelstrom under a stable specifier (existing pattern).
const providerTestSpecifier = './maelstrom.ts' + '?provider-test';
await import(providerTestSpecifier);

it('does not claim inert Live audio preparation succeeded when saving the first browser key', () => {
  vi.stubEnv('VITE_HOSTED', '1');
  selectVoiceProvider('live');
  expect(prepareBrowserOpenAIVoice()).toBe(false);
});

function realtimeOptions(): DemoRealtimeOptions {
  const options = state.realtimeOptions;
  if (!options) throw new Error('expected realtime options to be captured');
  return options;
}

function createAdapter(provider: 'livekit' | 'live' | 'openai') {
  return realtimeOptions().createAdapter({
    sessionId: SessionId('session-1'),
    provider: provider === 'openai' ? 'realtime' : provider,
  });
}

type OpenAIOptions = {
  greetingInterruption?: false | true | object;
  serverVad?: {
    threshold?: number;
  };
  transcription?: { model?: string };
  voice?: string;
  synthesizeGreeting?: (args: {
    text: string;
    voice: typeof DEMO_OPENAI_VOICE;
    signal: AbortSignal;
  }) => Promise<ArrayBuffer>;
  mintToken?: () => Promise<unknown>;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
  clearPlaygroundKey();
  state.liveKitAdapterOptions.length = 0;
  state.openAIAdapterOptions.length = 0;
  state.liveAdapterOptions.length = 0;
  state.openAIAdapterInstances.length = 0;
});

describe('demo voice provider wiring', () => {
  it('preserves unrelated package exports without constructing browser adapters', async () => {
    const [react, reactRealtime, openAI, liveKit] = await Promise.all([
      import('@maelstrom-co/react'),
      import('@maelstrom-co/react-realtime'),
      import('@maelstrom-co/realtime-openai'),
      import('@maelstrom-co/realtime-livekit'),
    ]);

    expect(Object.keys(react)).not.toContain('warnOnce');
    expect(reactRealtime.createLevelMeter).toBeTypeOf('function');
    expect(openAI.OpenAITokenGrantSchema.safeParse).toBeTypeOf('function');
    expect(liveKit.LiveKitTokenGrantSchema.safeParse).toBeTypeOf('function');
    expect(state.openAIAdapterOptions).toEqual([]);
    expect(state.liveKitAdapterOptions).toEqual([]);
  });

  it('installs diagnostics for every build alongside realtime and orchestration', () => {
    expect(state.installedExtensions).toEqual([
      state.extension,
      state.orchestrationExtension,
      expect.any(Function),
      state.devtoolsExtension,
    ]);
    expect(state.devtoolsOptions?.telemetry?.getSnapshot).toBeTypeOf(
      'function',
    );
  });

  it('configures adapter-owned browser VAD for LiveKit', () => {
    createAdapter('livekit');

    expect(state.liveKitAdapterOptions).toHaveLength(1);
    expect(state.liveKitAdapterOptions[0]).not.toHaveProperty(
      'greetingInterruption',
    );
    expect(state.liveKitAdapterOptions[0]).toMatchObject({
      roomName: 'maelstrom-session-1',
      vad: {
        assetBaseUrl: '/vad-web/',
        providerOptions: {
          positiveSpeechThreshold: 0.8,
          negativeSpeechThreshold: 0.65,
          redemptionMs: 200,
          preSpeechPadMs: 100,
          minSpeechMs: 100,
        },
      },
      debug: true,
    });
  });

  it.each([
    '0',
    '1',
  ])('leaves non-hosted OpenAI server VAD at adapter defaults (browser key=%s)', (browserKeyMode) => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', browserKeyMode);
    createAdapter('openai');

    expect(state.openAIAdapterOptions).toHaveLength(1);
    expect(state.openAIAdapterOptions[0]).toMatchObject({ debug: true });
    expect(state.openAIAdapterOptions[0]).not.toHaveProperty('vad');
    expect(state.openAIAdapterOptions[0]).not.toHaveProperty('serverVad');
    expect(
      (state.openAIAdapterOptions[0] as OpenAIOptions).transcription,
    ).toEqual({ model: 'gpt-4o-transcribe' });
    expect(
      (state.openAIAdapterOptions[0] as OpenAIOptions).greetingInterruption,
    ).toBe(true);
    expect(state.liveKitAdapterOptions).toHaveLength(0);
  });

  it('uses immediate server VAD with the hosted legacy greeting interrupter', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    createAdapter('openai');

    const options = state.openAIAdapterOptions[0] as OpenAIOptions;
    expect(options.serverVad).toEqual({
      threshold: 0.8,
      bargeInMode: 'immediate',
    });
    expect(options.transcription).toEqual({ model: 'gpt-4o-transcribe' });
    expect(options).not.toHaveProperty('vad');
    expect(options.greetingInterruption).toEqual({
      providerOptions: { model: 'legacy' },
    });
    expect(state.liveKitAdapterOptions).toHaveLength(0);
  });

  it('activates and hands off one browser-key adapter before session creation', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    vi.stubEnv('VITE_VOICE_PROVIDER', 'openai');
    selectVoiceProvider('realtime');

    expect(prepareBrowserOpenAIVoice()).toBe(true);
    expect(state.openAIAdapterInstances).toHaveLength(1);
    expect(state.openAIAdapterInstances[0]?.activateAudioCalls).toBe(1);
    expect(state.openAIAdapterOptions[0]).toMatchObject({
      serverVad: { threshold: 0.8, bargeInMode: 'immediate' },
    });

    const prepared = state.openAIAdapterInstances[0];
    expect(createAdapter('openai')).toBe(prepared);
    expect(state.openAIAdapterInstances).toHaveLength(1);
  });

  it('passes the demo greeting to maelstromRealtime', () => {
    const sessionId = SessionId('session-1');
    for (const provider of ['realtime', 'livekit'] as const)
      expect(realtimeOptions().opening({ sessionId, provider })).toEqual({
        greeting: { text: DEMO_GREETING },
      });
    expect(
      realtimeOptions().opening({ sessionId, provider: 'live' }),
    ).toMatchObject({
      generatedOpening: { instructions: expect.stringContaining('Maelstrom') },
    });
    expect(realtimeOptions().providers).toEqual([
      'live',
      'realtime',
      'livekit',
    ]);
    expect(realtimeOptions().onSession).toBe(registerDemoVoice);
    // Greeting must not disturb either provider's adapter construction.
    createAdapter('openai');
    createAdapter('livekit');
    expect(state.openAIAdapterOptions).toHaveLength(1);
    expect(state.liveKitAdapterOptions).toHaveLength(1);
  });

  it('wires cedar and the local same-origin synthesizer when the server owns the key', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    createAdapter('openai');
    const options = state.openAIAdapterOptions[0] as OpenAIOptions;
    expect(options.voice).toBe(DEMO_OPENAI_VOICE);
    expect(options.voice).toBe('cedar');
    expect(typeof options.synthesizeGreeting).toBe('function');

    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      const body = makeValidWavBytes();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(body.byteLength),
        },
      });
    }) as unknown as typeof fetch;

    await options.synthesizeGreeting!({
      text: DEMO_GREETING,
      voice: DEMO_OPENAI_VOICE,
      signal: new AbortController().signal,
    });

    expect(capturedUrl).toBe(DEMO_GREETING_TTS_ROUTE);
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.body).toBeUndefined();
    const auth = (capturedInit?.headers as Record<string, string> | undefined)
      ?.Authorization;
    expect(auth).toBeUndefined();
  });

  it('uses browser-direct OpenAI paths on localhost when the server key is missing', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    setPlaygroundKey('sk-local-browser-key-1234567890');
    createAdapter('openai');
    const options = state.openAIAdapterOptions[0] as OpenAIOptions;

    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedAuth = (init?.headers as Record<string, string> | undefined)
        ?.Authorization;
      const body = makeValidWavBytes();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(body.byteLength),
        },
      });
    }) as unknown as typeof fetch;

    await options.synthesizeGreeting!({
      text: DEMO_GREETING,
      voice: DEMO_OPENAI_VOICE,
      signal: new AbortController().signal,
    });

    expect(capturedUrl).toBe(DEMO_GREETING_TTS_URL);
    expect(capturedAuth).toBe('Bearer sk-local-browser-key-1234567890');
    expect(options.greetingInterruption).toBe(true);
    await expect(options.mintToken?.()).rejects.toThrow(
      /createBrowserMintToken should not be called in tests/,
    );
  });

  it('wires cedar and the browser-direct synthesizer with lazy key reads in hosted mode', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    createAdapter('openai');
    const options = state.openAIAdapterOptions[0] as OpenAIOptions;
    expect(options.voice).toBe('cedar');
    expect(typeof options.synthesizeGreeting).toBe('function');

    const auths: string[] = [];
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.Authorization) auths.push(headers.Authorization);
      const body = makeValidWavBytes();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(body.byteLength),
        },
      });
    }) as unknown as typeof fetch;

    // No key yet — must fail before fetch.
    await expect(
      options.synthesizeGreeting!({
        text: DEMO_GREETING,
        voice: DEMO_OPENAI_VOICE,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/key/i);
    expect(urls).toHaveLength(0);

    setPlaygroundKey('sk-first-key-1234567890');
    await options.synthesizeGreeting!({
      text: DEMO_GREETING,
      voice: DEMO_OPENAI_VOICE,
      signal: new AbortController().signal,
    });
    expect(urls).toEqual([DEMO_GREETING_TTS_URL]);
    expect(auths).toEqual(['Bearer sk-first-key-1234567890']);

    // Lazy re-read on the next attempt after a key change.
    setPlaygroundKey('sk-second-key-0987654321');
    await options.synthesizeGreeting!({
      text: DEMO_GREETING,
      voice: DEMO_OPENAI_VOICE,
      signal: new AbortController().signal,
    });
    expect(urls).toHaveLength(2);
    expect(auths[1]).toBe('Bearer sk-second-key-0987654321');
  });
});

for (const hosted of ['0', '1']) {
  it(`enables the local playback gate on both speech-native paths (hosted=${hosted})`, () => {
    vi.stubEnv('VITE_HOSTED', hosted);
    createAdapter('live');
    createAdapter('openai');
    for (const options of [
      state.liveAdapterOptions.at(-1),
      state.openAIAdapterOptions.at(-1),
    ])
      expect(options).toHaveProperty('playbackBargeIn', {
        providerOptions: { model: 'legacy' },
      });
    expect(state.liveAdapterOptions.at(-1)).not.toHaveProperty('serverVad');
  });
}
