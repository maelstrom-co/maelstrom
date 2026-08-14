import type {
  CreateAdapterContext,
  MaelstromRealtimeOptions,
} from '@maelstrom-co/react-realtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeValidWavBytes } from './__tests__/wav-fixtures';
import {
  DEMO_GREETING,
  DEMO_GREETING_TTS_ROUTE,
  DEMO_GREETING_TTS_URL,
  DEMO_OPENAI_VOICE,
} from './demo-greeting-tts';
import { clearPlaygroundKey, setPlaygroundKey } from './playground-key-store';

const state = vi.hoisted(() => ({
  extension: {},
  orchestrationExtension: {},
  installedExtensions: [] as unknown[],
  realtimeOptions: undefined as MaelstromRealtimeOptions | undefined,
  liveKitAdapterOptions: [] as unknown[],
  openAIAdapterOptions: [] as unknown[],
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
  maelstromRealtime: (options: MaelstromRealtimeOptions) => {
    state.realtimeOptions = options;
    return state.extension;
  },
}));
vi.mock('@maelstrom-co/realtime-openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime-openai')>()),
  OpenAIAdapter: class {
    constructor(options: unknown) {
      state.openAIAdapterOptions.push(options);
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
vi.mock('./voice/get-livekit-token', () => ({
  getLivekitToken: () => Promise.resolve(),
}));

// Static import of maelstrom under a stable specifier (existing pattern).
const providerTestSpecifier = './maelstrom.ts' + '?provider-test';
await import(providerTestSpecifier);

function createAdapter(provider: 'livekit' | 'openai') {
  vi.stubEnv('VITE_VOICE_PROVIDER', provider);
  const options = state.realtimeOptions;
  if (!options) throw new Error('expected realtime options to be captured');
  return options.createAdapter({
    sessionId: 'session-1',
  } as CreateAdapterContext);
}

type OpenAIOptions = {
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

  it('installs the plain realtime and orchestration extensions', () => {
    expect(state.installedExtensions).toEqual([
      state.extension,
      state.orchestrationExtension,
    ]);
  });

  it('configures adapter-owned browser VAD for LiveKit', () => {
    createAdapter('livekit');

    expect(state.liveKitAdapterOptions).toHaveLength(1);
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

  it('does not pass browser VAD configuration to OpenAI', () => {
    createAdapter('openai');

    expect(state.openAIAdapterOptions).toHaveLength(1);
    expect(state.openAIAdapterOptions[0]).toMatchObject({ debug: true });
    expect(state.openAIAdapterOptions[0]).not.toHaveProperty('vad');
    expect(state.liveKitAdapterOptions).toHaveLength(0);
  });

  it('passes the demo greeting to maelstromRealtime', () => {
    expect(state.realtimeOptions?.greeting).toEqual({ text: DEMO_GREETING });
    // Greeting must not disturb either provider's adapter construction.
    createAdapter('openai');
    createAdapter('livekit');
    expect(state.openAIAdapterOptions).toHaveLength(1);
    expect(state.liveKitAdapterOptions).toHaveLength(1);
  });

  it('wires cedar and the local same-origin synthesizer in non-hosted mode', async () => {
    vi.stubEnv('VITE_HOSTED', undefined);
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
