import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { SessionId } from '@maelstrom-co/protocol';
import type {
  VoiceSessionCallbacks,
  VoiceSessionConfig,
} from '@maelstrom-co/voice-server';

import { DEMO_KEYTERMS } from './demo-keyterms.js';

const capturedRoutes = new Map<string, unknown>();
const testSessionId = 'session-test';
const testLanguage = 'en-US';
const testDeepgramApiKey = 'deepgram-test-key';
const testCartesiaApiKey = 'cartesia-test-key';

let capturedVoiceSessionConfig: VoiceSessionConfig | undefined;
const sentMessages: string[] = [];
let capturedVoiceSessionCallbacks: VoiceSessionCallbacks | undefined;

type DemoWsRoute = (context: {
  req: { query: (key: string) => string | undefined };
}) => {
  onOpen?: (
    event: unknown,
    wsContext: { send: (data: string | ArrayBuffer) => void },
  ) => Promise<void>;
};

function invokeWsRoute(): ReturnType<DemoWsRoute> {
  capturedRoutes.clear();
  createDemoWsApp();
  const registeredWsRoute = capturedRoutes.get('/ws');

  expect(typeof registeredWsRoute).toBe('function');

  return (registeredWsRoute as DemoWsRoute)({
    req: {
      query: (key: string) => {
        if (key === 'sessionId') {
          return testSessionId;
        }

        if (key === 'language') {
          return testLanguage;
        }

        return undefined;
      },
    },
  });
}

function openWsRoute(handlers: ReturnType<DemoWsRoute>) {
  return handlers.onOpen?.(
    {},
    {
      send: (data: string | ArrayBuffer) => {
        if (typeof data === 'string') {
          sentMessages.push(data);
        }
      },
    },
  );
}

const voiceSessionStub = {
  kind: 'voice-session-stub',
  warmup: mock(async () => {}),
  getVoiceState: mock(() => 'idle'),
  startListening: mock(async () => {}),
  stopListening: mock(async () => {}),
  interrupt: mock(() => {}),
  processRequest: mock(async () => undefined),
  handleVADEvent: mock(() => {}),
  sendAudioChunk: mock(() => {}),
  speak: mock(async () => {}),
  destroy: mock(() => {}),
};

const createVoiceSession = mock(
  (config: VoiceSessionConfig, callbacks: VoiceSessionCallbacks) => {
    capturedVoiceSessionConfig = config;
    capturedVoiceSessionCallbacks = callbacks;

    return voiceSessionStub;
  },
);

const createEngine = mock(() => ({
  handle: mock(async () => ({
    ok: true,
    value: { type: 'chart_response', response: { userMessage: '' } },
  })),
}));

const createInMemoryStore = mock(() => ({ kind: 'history-store' }));
const geminiText = mock(() => ({ kind: 'gemini-adapter' }));
const buildChartRequest = mock(() => ({
  type: 'chart_request',
  context: {
    updateReasons: [{ type: 'user_intent', intent: 'stub' }],
    chartDimensions: { columns: 12, rows: 8 },
    layoutMode: 'tiling',
  },
  instances: [],
  vessels: [],
  layout: { type: 'tiling', tree: [], instances: [] },
}));
const processIntent = { process: mock(async () => ({ userMessage: 'stub' })) };
const createDemoVoiceIntentAdapter = mock(() => ({
  buildChartRequest,
  processIntent,
}));
const createDemoVoiceWsSessionController = mock(() => ({
  onOpen: mock(async () => {}),
  onMessage: mock(async () => {}),
  onClose: mock(() => {}),
  onError: mock(() => {}),
  getLatestChartRequest: mock(() => null),
  getExplicitRequestId: mock(() => null),
}));

mock.module('@maelstrom-co/engine', () => ({
  createEngine,
  createInMemoryStore,
}));

mock.module('@tanstack/ai-gemini', () => ({
  geminiText,
}));

mock.module('@maelstrom-co/voice-server', () => ({
  createVoiceSession,
}));

mock.module('./voice-intent-adapter.js', () => ({
  createDemoVoiceIntentAdapter,
}));

mock.module('./voice-ws-session.js', () => ({
  createDemoVoiceWsSessionController,
}));

mock.module('hono', () => ({
  Hono: class HonoMock {
    fetch = mock(() => undefined);

    use = mock(() => this);

    get = mock((path: string, handler: unknown) => {
      capturedRoutes.set(path, handler);
      return this;
    });
  },
}));

mock.module('hono/bun', () => ({
  createBunWebSocket: () => ({
    upgradeWebSocket: (handler: unknown) => handler,
    websocket: {},
  }),
}));

mock.module('hono/cors', () => ({
  cors: mock(() => 'cors-middleware'),
}));

const { createDemoWsApp } = await import('./ws-server.js');

describe('ws-server voice session config', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    capturedVoiceSessionConfig = undefined;
    capturedVoiceSessionCallbacks = undefined;
    createVoiceSession.mockClear();
    createDemoVoiceIntentAdapter.mockClear();
    createDemoVoiceWsSessionController.mockClear();
    voiceSessionStub.warmup.mockClear();
    voiceSessionStub.getVoiceState.mockClear();
    voiceSessionStub.startListening.mockClear();
    voiceSessionStub.stopListening.mockClear();
    voiceSessionStub.interrupt.mockClear();
    voiceSessionStub.processRequest.mockClear();
    voiceSessionStub.handleVADEvent.mockClear();
    voiceSessionStub.sendAudioChunk.mockClear();
    voiceSessionStub.speak.mockClear();
    voiceSessionStub.destroy.mockClear();
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.CARTESIA_API_KEY;
  });

  test('passes discriminated deepgram and cartesia configs into createVoiceSession', async () => {
    process.env.DEEPGRAM_API_KEY = testDeepgramApiKey;
    process.env.CARTESIA_API_KEY = testCartesiaApiKey;

    invokeWsRoute();

    expect(createVoiceSession).toHaveBeenCalledTimes(1);

    const config = capturedVoiceSessionConfig;
    const callbacks = capturedVoiceSessionCallbacks;

    expect(config).toBeDefined();
    expect(callbacks).toBeDefined();

    if (!config || !callbacks) {
      throw new Error(
        'Expected createVoiceSession to receive config and callbacks',
      );
    }

    expect(config.stt.type).toBe('deepgram');
    if (config.stt.type !== 'deepgram') {
      throw new Error('Expected demo STT provider to be deepgram');
    }
    expect(config.stt).toEqual({
      type: 'deepgram',
      options: {
        apiKey: testDeepgramApiKey,
        keyterms: DEMO_KEYTERMS,
        vadEvents: true,
      },
    });
    expect(config.stt.options.keyterms).toBe(DEMO_KEYTERMS);
    expect(config.tts).toEqual({
      type: 'cartesia',
      options: {
        defaultVoiceId: 'e8e5fffb-252c-436d-b842-8879b84445b6',
        apiKey: testCartesiaApiKey,
      },
    });
    expect(config.sessionId).toBe(SessionId(testSessionId));
    expect(config.language).toBe(testLanguage);
    expect(config.interimResults).toBe(true);
    expect(config.vadFinalDebounceMs).toBe(250);
    expect(config).toMatchObject({
      processIntent: {
        process: expect.any(Function),
      },
    });
    expect(config.buildChartRequest).toEqual(expect.any(Function));
    expect(typeof callbacks.onTranscript).toBe('function');
    expect(typeof callbacks.onAudioOutput).toBe('function');
    expect(voiceSessionStub.warmup).not.toHaveBeenCalled();
  });

  test('serializes provider-classified runtime errors with additive engine.error metadata', async () => {
    process.env.DEEPGRAM_API_KEY = testDeepgramApiKey;
    process.env.CARTESIA_API_KEY = testCartesiaApiKey;

    const handlers = invokeWsRoute();

    await openWsRoute(handlers);

    const callbacks = capturedVoiceSessionCallbacks;
    if (typeof callbacks?.onError !== 'function') {
      throw new Error(
        'Expected voice session onError callback to be registered',
      );
    }

    const rootCause = new Error('request rejected by upstream');
    const nestedCause = new Error('Deepgram websocket closed', {
      cause: rootCause,
    });

    callbacks.onError(
      Object.assign(
        new Error('Deepgram subscription overage', {
          cause: nestedCause,
        }),
        {
          kind: 'quota',
          source: 'stt',
          provider: 'deepgram',
        },
      ),
    );

    expect(JSON.parse(sentMessages.at(-1) as string)).toMatchObject({
      type: 'engine.error',
      sessionId: testSessionId,
      error:
        'Deepgram subscription overage: Deepgram websocket closed: request rejected by upstream',
      kind: 'quota',
      source: 'stt',
      provider: 'deepgram',
    });
  });

  test('preserves queued speech-start metadata on engine.tts.sent messages', async () => {
    process.env.DEEPGRAM_API_KEY = testDeepgramApiKey;
    process.env.CARTESIA_API_KEY = testCartesiaApiKey;

    const handlers = invokeWsRoute();

    await openWsRoute(handlers);

    const callbacks = capturedVoiceSessionCallbacks;
    if (typeof callbacks?.onSpeechStarted !== 'function') {
      throw new Error(
        'Expected voice session onSpeechStarted callback to be registered',
      );
    }

    callbacks.onSpeechStarted({
      text: 'queued hello',
      format: 'pcm_f32le',
      sampleRate: 44100,
      queued: true,
    });

    expect(JSON.parse(sentMessages.at(-1) as string)).toMatchObject({
      type: 'engine.tts.sent',
      sessionId: testSessionId,
      text: 'queued hello',
      format: 'pcm_f32le',
      sampleRate: 44100,
      sequence: 0,
      isFinal: false,
      queued: true,
    });
  });

  test('reports voice-session construction failures after the websocket opens', async () => {
    process.env.DEEPGRAM_API_KEY = testDeepgramApiKey;
    process.env.CARTESIA_API_KEY = testCartesiaApiKey;
    createVoiceSession.mockImplementationOnce(() => {
      const cause = new Error('transport bootstrap failed', {
        cause: new Error('inner setup failure'),
      });
      throw new Error('voice session setup failed', { cause });
    });

    const handlers = invokeWsRoute();

    await openWsRoute(handlers);

    expect(sentMessages).toHaveLength(1);
    expect(JSON.parse(sentMessages[0] as string)).toMatchObject({
      type: 'engine.error',
      sessionId: testSessionId,
      error:
        'voice session setup failed: transport bootstrap failed: inner setup failure',
    });
  });

  test('reports when voice is disabled because provider keys are missing', async () => {
    const handlers = invokeWsRoute();

    await openWsRoute(handlers);

    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(sentMessages).toHaveLength(1);
    expect(JSON.parse(sentMessages[0] as string)).toMatchObject({
      type: 'engine.error',
      sessionId: testSessionId,
      error: 'Voice disabled: missing DEEPGRAM_API_KEY or CARTESIA_API_KEY',
    });
  });
});
