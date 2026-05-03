import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { DEMO_KEYTERMS } from './demo-keyterms.js';

const capturedRoutes = new Map<string, unknown>();
let capturedVoiceSessionConfig: unknown;
const sentMessages: string[] = [];
let capturedVoiceSessionCallbacks:
  | {
      onTranscript?: unknown;
      onAudioOutput?: unknown;
    }
  | undefined;

const voiceSessionStub = { kind: 'voice-session-stub' };
const createVoiceSession = mock((config: unknown, callbacks: unknown) => {
  capturedVoiceSessionConfig = config;
  capturedVoiceSessionCallbacks = callbacks as {
    onTranscript?: unknown;
    onAudioOutput?: unknown;
  };

  return voiceSessionStub;
});
const createEngine = mock(() => ({
  process: mock(async () => ({ userMessage: '' })),
  addAssistantMessage: mock(async () => {}),
}));
const createInMemoryHistoryStore = mock(() => ({ kind: 'history-store' }));
const createTanStackProvider = mock(() => ({ kind: 'provider' }));
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
}));

mock.module('@maelstrom-co/engine-old', () => ({
  createEngine,
  createInMemoryHistoryStore,
  createTanStackProvider,
}));

mock.module('@maelstrom-co/protocol', () => ({
  SessionId: (value: string) => value,
}));

mock.module('@maelstrom-co/voice-server', () => ({
  createVoiceSession,
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

mock.module('./voice-intent-adapter.js', () => ({
  createDemoVoiceIntentAdapter,
}));

mock.module('./voice-ws-session.js', () => ({
  createDemoVoiceWsSessionController,
}));

await import('./ws-server.js');

const registeredWsRoute = capturedRoutes.get('/ws');

describe('ws-server voice session config', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    capturedVoiceSessionConfig = undefined;
    capturedVoiceSessionCallbacks = undefined;
    createVoiceSession.mockClear();
    createDemoVoiceWsSessionController.mockClear();
    process.env.DEEPGRAM_API_KEY = undefined;
    process.env.CARTESIA_API_KEY = undefined;
  });

  test('passes discriminated deepgram and cartesia configs into createVoiceSession', async () => {
    process.env.DEEPGRAM_API_KEY = 'deepgram-test-key';
    process.env.CARTESIA_API_KEY = 'cartesia-test-key';

    expect(typeof registeredWsRoute).toBe('function');

    (
      registeredWsRoute as (context: {
        req: { query: (key: string) => string | undefined };
      }) => unknown
    )({
      req: {
        query: (key: string) => {
          if (key === 'sessionId') {
            return 'session-test';
          }

          if (key === 'language') {
            return 'en-US';
          }

          return undefined;
        },
      },
    });

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

    expect(config).toMatchObject({
      stt: {
        type: 'deepgram',
        options: {
          apiKey: 'deepgram-test-key',
          keyterms: DEMO_KEYTERMS,
          vadEvents: true,
        },
      },
      tts: {
        type: 'cartesia',
        options: {
          defaultVoiceId: 'e8e5fffb-252c-436d-b842-8879b84445b6',
          apiKey: 'cartesia-test-key',
        },
      },
      sessionId: 'session-test',
      language: 'en-US',
      interimResults: true,
      vadFinalDebounceMs: 250,
      buildChartRequest,
      processIntent,
    });
    expect(typeof callbacks.onTranscript).toBe('function');
    expect(typeof callbacks.onAudioOutput).toBe('function');
    expect(createDemoVoiceWsSessionController).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-test',
        voiceSession: voiceSessionStub,
        engine: expect.any(Object),
      }),
    );
  });

  test('reports voice-session construction failures after the websocket opens', async () => {
    process.env.DEEPGRAM_API_KEY = 'deepgram-test-key';
    process.env.CARTESIA_API_KEY = 'cartesia-test-key';
    createVoiceSession.mockImplementationOnce(() => {
      const cause = new Error('inner setup failure');
      throw new Error('voice session setup failed', { cause });
    });

    expect(typeof registeredWsRoute).toBe('function');

    const handlers = (
      registeredWsRoute as (context: {
        req: { query: (key: string) => string | undefined };
      }) => {
        onOpen: (
          event: unknown,
          wsContext: { send: (data: string | ArrayBuffer) => void },
        ) => Promise<void>;
      }
    )({
      req: {
        query: (key: string) => {
          if (key === 'sessionId') {
            return 'session-test';
          }

          if (key === 'language') {
            return 'en-US';
          }

          return undefined;
        },
      },
    });

    await handlers.onOpen(
      {},
      {
        send: (data: string | ArrayBuffer) => {
          if (typeof data === 'string') {
            sentMessages.push(data);
          }
        },
      },
    );

    expect(sentMessages).toHaveLength(1);
    expect(JSON.parse(sentMessages[0] as string)).toMatchObject({
      type: 'engine.error',
      sessionId: 'session-test',
      error: 'voice session setup failed: inner setup failure',
    });
  });

  test('reports when voice is disabled because provider keys are missing', async () => {
    expect(typeof registeredWsRoute).toBe('function');

    const handlers = (
      registeredWsRoute as (context: {
        req: { query: (key: string) => string | undefined };
      }) => {
        onOpen: (
          event: unknown,
          wsContext: { send: (data: string | ArrayBuffer) => void },
        ) => Promise<void>;
      }
    )({
      req: {
        query: (key: string) => {
          if (key === 'sessionId') {
            return 'session-test';
          }

          if (key === 'language') {
            return 'en-US';
          }

          return undefined;
        },
      },
    });

    await handlers.onOpen(
      {},
      {
        send: (data: string | ArrayBuffer) => {
          if (typeof data === 'string') {
            sentMessages.push(data);
          }
        },
      },
    );

    expect(createVoiceSession).not.toHaveBeenCalled();
    expect(sentMessages).toHaveLength(1);
    expect(JSON.parse(sentMessages[0] as string)).toMatchObject({
      type: 'engine.error',
      sessionId: 'session-test',
      error: 'Voice disabled: missing DEEPGRAM_API_KEY or CARTESIA_API_KEY',
    });
  });
});
