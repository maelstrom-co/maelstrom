import { SessionId } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectVoiceProvider } from './voice-provider';

interface ConstructedOpenAIAdapter {
  activateAudioCalls: number;
  options: { mintToken: () => Promise<unknown> };
}

const constructed = vi.hoisted(() => ({
  liveKit: [] as Array<Record<string, unknown>>,
  openAI: [] as ConstructedOpenAIAdapter[],
  live: [] as unknown[],
  activateAudioError: undefined as Error | undefined,
}));

const mint = vi.hoisted(() => ({
  server: vi.fn(() => Promise.resolve({})),
  browser: vi.fn(() => Promise.resolve({})),
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
    options: ConstructedOpenAIAdapter['options'];
    constructor(options: ConstructedOpenAIAdapter['options']) {
      this.options = options;
      constructed.openAI.push(this);
    }
    activateAudio() {
      this.activateAudioCalls += 1;
      return constructed.activateAudioError
        ? Promise.reject(constructed.activateAudioError)
        : Promise.resolve();
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
  mintOpenAIToken: mint.server,
  createBrowserMintToken: () => mint.browser,
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
  vi.clearAllMocks();
  constructed.liveKit.length = 0;
  constructed.openAI.length = 0;
  constructed.live.length = 0;
  constructed.activateAudioError = undefined;
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

  it('mints a server token for the session when the server owns the key', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');

    createAdapter('realtime', sessionId);
    expect(mint.server).not.toHaveBeenCalled();

    await constructed.openAI[0]?.options.mintToken();

    expect(mint.server).toHaveBeenCalledExactlyOnceWith(sessionId);
    expect(mint.browser).not.toHaveBeenCalled();
  });

  it('mints with the browser key in browser-key mode', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');

    createAdapter('realtime', sessionId);
    expect(mint.browser).not.toHaveBeenCalled();

    await constructed.openAI[0]?.options.mintToken();

    expect(mint.browser).toHaveBeenCalledOnce();
    expect(mint.server).not.toHaveBeenCalled();
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

  it('keeps the prepared adapter for realtime while other providers build fresh ones', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    selectVoiceProvider('realtime');

    expect(prepareBrowserOpenAIVoice()).toBe(true);
    const prepared = constructed.openAI[0];

    expect(createAdapter('livekit', sessionId)).not.toBe(prepared);
    expect(createAdapter('live', sessionId)).not.toBe(prepared);
    expect(constructed.liveKit).toHaveLength(1);
    expect(constructed.live).toHaveLength(1);

    expect(createAdapter('realtime', sessionId)).toBe(prepared);
    expect(constructed.openAI).toHaveLength(1);
  });

  it('reuses one prepared adapter when prepared twice before a session', () => {
    vi.stubEnv('VITE_HOSTED', '1');
    selectVoiceProvider('realtime');

    expect(prepareBrowserOpenAIVoice()).toBe(true);
    expect(prepareBrowserOpenAIVoice()).toBe(true);

    expect(constructed.openAI).toHaveLength(1);
    const prepared = constructed.openAI[0];
    expect(prepared?.activateAudioCalls).toBe(2);
    expect(createAdapter('realtime', sessionId)).toBe(prepared);
  });

  it('still reports success when unlocking audio rejects', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    selectVoiceProvider('realtime');
    constructed.activateAudioError = new Error('autoplay blocked');

    expect(prepareBrowserOpenAIVoice()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const prepared = constructed.openAI[0];
    expect(prepared?.activateAudioCalls).toBe(1);
    expect(createAdapter('realtime', sessionId)).toBe(prepared);
  });
});
