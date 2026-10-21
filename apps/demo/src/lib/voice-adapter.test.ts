import { SessionId } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectVoiceProvider } from './voice-provider';

const constructed = vi.hoisted(() => ({
  liveKit: [] as Array<Record<string, unknown>>,
  openAI: [] as Array<{ activateAudioCalls: number }>,
  live: [] as unknown[],
}));

vi.mock('@maelstrom-co/realtime-livekit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime-livekit')>()),
  LiveKitAdapter: class {
    constructor(options: Record<string, unknown>) {
      constructed.liveKit.push(options);
    }
  },
}));
vi.mock('@maelstrom-co/realtime-openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime-openai')>()),
  OpenAIAdapter: class {
    activateAudioCalls = 0;
    constructor() {
      constructed.openAI.push(this);
    }
    activateAudio() {
      this.activateAudioCalls += 1;
    }
  },
}));
vi.mock('@maelstrom-co/realtime-openai-live', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@maelstrom-co/realtime-openai-live')
  >()),
  OpenAILiveAdapter: class {
    constructor(options: unknown) {
      constructed.live.push(options);
    }
  },
}));
vi.mock('./mint-token', () => ({
  mintOpenAIToken: () => Promise.resolve(),
  createBrowserMintToken: () => async () => {
    throw new Error('createBrowserMintToken should not be called in tests');
  },
}));
vi.mock('./voice/get-livekit-token', () => ({
  getLivekitToken: () => Promise.resolve(),
}));

const { createAdapter, prepareBrowserOpenAIVoice } = await import(
  './voice-adapter'
);

const sessionId = SessionId('session-1');

afterEach(() => {
  vi.unstubAllEnvs();
  constructed.liveKit.length = 0;
  constructed.openAI.length = 0;
  constructed.live.length = 0;
});

describe('createAdapter', () => {
  it('builds a LiveKit adapter scoped to the session room', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');

    createAdapter('livekit', sessionId);

    expect(constructed.liveKit).toHaveLength(1);
    expect(constructed.liveKit[0]).toMatchObject({
      roomName: 'maelstrom-session-1',
    });
    expect(constructed.openAI).toHaveLength(0);
    expect(constructed.live).toHaveLength(0);
  });

  it('builds the speech-native Live adapter for the live provider', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');

    createAdapter('live', sessionId);

    expect(constructed.live).toHaveLength(1);
    expect(constructed.openAI).toHaveLength(0);
    expect(constructed.liveKit).toHaveLength(0);
  });

  it('builds an OpenAI Realtime adapter for the realtime provider', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');

    createAdapter('realtime', sessionId);

    expect(constructed.openAI).toHaveLength(1);
    expect(constructed.live).toHaveLength(0);
    expect(constructed.liveKit).toHaveLength(0);
  });
});

describe('prepareBrowserOpenAIVoice', () => {
  it('declines when the server owns the key', () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    selectVoiceProvider('realtime');

    expect(prepareBrowserOpenAIVoice()).toBe(false);
    expect(constructed.openAI).toHaveLength(0);
  });

  it('declines for the Live provider in browser-key mode', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    selectVoiceProvider('live');

    expect(prepareBrowserOpenAIVoice()).toBe(false);
    expect(constructed.openAI).toHaveLength(0);
  });

  it('hands the prepared adapter to the next realtime session exactly once', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    selectVoiceProvider('realtime');

    expect(prepareBrowserOpenAIVoice()).toBe(true);
    const prepared = constructed.openAI[0];
    expect(prepared?.activateAudioCalls).toBe(1);

    expect(createAdapter('realtime', sessionId)).toBe(prepared);
    expect(createAdapter('realtime', sessionId)).not.toBe(prepared);
    expect(constructed.openAI).toHaveLength(2);
  });
});
