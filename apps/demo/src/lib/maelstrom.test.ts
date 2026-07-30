import type {
  CreateAdapterContext,
  MaelstromRealtimeOptions,
} from '@maelstrom-co/react-realtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@maelstrom-co/realtime/openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime/openai')>()),
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

afterEach(() => {
  vi.unstubAllEnvs();
  state.liveKitAdapterOptions.length = 0;
  state.openAIAdapterOptions.length = 0;
});

describe('demo voice provider wiring', () => {
  it('preserves unrelated package exports without constructing browser adapters', async () => {
    const [react, reactRealtime, openAI, liveKit] = await Promise.all([
      import('@maelstrom-co/react'),
      import('@maelstrom-co/react-realtime'),
      import('@maelstrom-co/realtime/openai'),
      import('@maelstrom-co/realtime-livekit'),
    ]);

    expect(react.warnOnce).toBeTypeOf('function');
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
});
