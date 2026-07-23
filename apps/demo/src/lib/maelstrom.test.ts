import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateAdapterContext,
  MaelstromRealtimeOptions,
} from '@maelstrom-co/react-realtime';

const extension = {};
const orchestrationExtension = {};
const installedExtensions: unknown[] = [];
let realtimeOptions: MaelstromRealtimeOptions | undefined;
const liveKitAdapterOptions: unknown[] = [];
const openAIAdapterOptions: unknown[] = [];

vi.doMock('@maelstrom-co/react', () => ({
  createMaelstrom: () => {
    const maelstrom = {
      with: (candidate: unknown) => {
        installedExtensions.push(candidate);
        return maelstrom;
      },
    };
    return maelstrom;
  },
}));
vi.doMock('@maelstrom-co/react-realtime', () => ({
  maelstromRealtime: (options: MaelstromRealtimeOptions) => {
    realtimeOptions = options;
    return extension;
  },
}));
vi.doMock('@maelstrom-co/realtime/openai', () => ({
  OpenAIAdapter: class {
    constructor(options: unknown) {
      openAIAdapterOptions.push(options);
    }
  },
}));
vi.doMock('@maelstrom-co/realtime-livekit', () => ({
  LiveKitAdapter: class {
    constructor(options: unknown) {
      liveKitAdapterOptions.push(options);
    }
  },
}));
vi.doMock('../vessels/calendar.vessel', () => ({ calendarEntry: {} }));
vi.doMock('../vessels/journal.vessel', () => ({ journalEntry: {} }));
vi.doMock('../vessels/map.vessel', () => ({ mapEntry: {} }));
vi.doMock('../vessels/tasks.vessel', () => ({ tasksEntry: {} }));
vi.doMock('../vessels/weather.vessel', () => ({ weatherEntry: {} }));
vi.doMock('./debug-mode', () => ({ isDebugRequested: () => true }));
vi.doMock('./mint-token', () => ({
  mintOpenAIToken: () => Promise.resolve(),
}));
vi.doMock('./orchestration-legibility', () => ({
  orchestrationLegibility: orchestrationExtension,
}));
vi.doMock('./voice/get-livekit-token', () => ({
  getLivekitToken: () => Promise.resolve(),
}));

const providerTestSpecifier = './maelstrom.ts' + '?provider-test';
await import(providerTestSpecifier);

function createAdapter(provider: 'livekit' | 'openai') {
  process.env.VITE_VOICE_PROVIDER = provider;
  const options = realtimeOptions;
  if (!options) throw new Error('expected realtime options to be captured');
  return options.createAdapter({
    sessionId: 'session-1',
  } as CreateAdapterContext);
}

afterEach(() => {
  delete process.env.VITE_VOICE_PROVIDER;
  liveKitAdapterOptions.length = 0;
  openAIAdapterOptions.length = 0;
});

describe('demo voice provider wiring', () => {
  it('installs the plain realtime and orchestration extensions', () => {
    expect(installedExtensions).toEqual([extension, orchestrationExtension]);
  });

  it('configures adapter-owned browser VAD for LiveKit', () => {
    createAdapter('livekit');

    expect(liveKitAdapterOptions).toHaveLength(1);
    expect(liveKitAdapterOptions[0]).toMatchObject({
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

    expect(openAIAdapterOptions).toHaveLength(1);
    expect(openAIAdapterOptions[0]).toMatchObject({ debug: true });
    expect(openAIAdapterOptions[0]).not.toHaveProperty('vad');
    expect(liveKitAdapterOptions).toHaveLength(0);
  });
});
