import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { TTSEvent } from '../../types.js';
import { createCartesiaTTS } from './index.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sentMessages: string[] = [];

  constructor(
    public url: string,
    public options?: { headers?: Record<string, string> },
  ) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code: 1000 }));
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

class ThrowOnSendWebSocket extends MockWebSocket {
  override send(_data: string) {
    throw new Error('mock cartesia send failure');
  }
}

const OriginalWebSocket = globalThis.WebSocket;

describe('createCartesiaTTS', () => {
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    process.env.CARTESIA_API_KEY = mockApiKey;
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    delete process.env.CARTESIA_API_KEY;
    globalThis.WebSocket = OriginalWebSocket;
  });

  test('reports streaming capabilities', () => {
    const provider = createCartesiaTTS();
    expect(provider.capabilities).toEqual({ streamingTts: true });
  });

  test('connects and reports ready transport state', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    expect(provider.isConnected()).toBe(true);
    expect(events).toEqual([]);
    expect(MockWebSocket.instances.at(-1)?.options?.headers).toEqual({
      Authorization: `Bearer ${mockApiKey}`,
      'Cartesia-Version': '2024-06-10',
      'X-API-Key': mockApiKey,
    });
  });

  test('uses configured websocket transport settings', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
      baseUrl: 'wss://api.cartesia.example',
      cartesiaVersion: '2026-03-01',
      connectionTimeoutMs: 500,
    });

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.url).toBe(
      'wss://api.cartesia.example/tts/websocket?cartesia_version=2026-03-01',
    );
  });

  test('preserves an existing websocket path while appending version query', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
      baseUrl: 'wss://api.cartesia.example/tts/websocket?foo=bar',
      cartesiaVersion: '2026-03-01',
    });

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.url).toBe(
      'wss://api.cartesia.example/tts/websocket?foo=bar&cartesia_version=2026-03-01',
    );
  });

  test('sends a request and emits completion chunks', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    const handle = provider.speak('Hello');

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(
      JSON.stringify({
        type: 'chunk',
        data: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
      }),
    );
    mockWs?.simulateMessage(JSON.stringify({ done: true }));
    await expect(handle.completion).resolves.toBe('completed');

    expect(handle.speech).toEqual({
      text: 'Hello',
      format: 'pcm_f32le',
      sampleRate: 44100,
      queued: false,
    });
    expect(events[0]?.type).toBe('chunk');
    expect(events[1]?.type).toBe('chunk');
    expect(events).toHaveLength(2);
  });

  test('disconnect emits disconnected only once', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    await provider.disconnect();

    expect(
      events.filter((event) => event.type === 'disconnected'),
    ).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      type: 'disconnected',
      clean: true,
      reason: 'clean_shutdown',
      message: 'Cartesia WebSocket disconnected cleanly',
    });
  });

  test('stop sends a cancel message for the active context', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    const handle = provider.speak('Hello');
    provider.stop();
    await expect(handle.completion).resolves.toBe('stopped');

    const mockWs = MockWebSocket.instances.at(-1);
    const cancelMessage = mockWs?.sentMessages.at(-1);
    expect(cancelMessage).toBeDefined();
    expect(typeof cancelMessage).toBe('string');
    expect(JSON.parse(String(cancelMessage))).toMatchObject({ cancel: true });
    expect(events).toEqual([]);
  });

  test('replacing an active speak settles the previous handle as stopped', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });

    await provider.connect();

    const firstHandle = provider.speak('First');
    const secondHandle = provider.speak('Second');

    await expect(firstHandle.completion).resolves.toBe('stopped');

    const mockWs = MockWebSocket.instances.at(-1);
    const lastRequest = mockWs?.sentMessages.at(-1);

    expect(secondHandle.speech).toEqual({
      text: 'Second',
      format: 'pcm_f32le',
      sampleRate: 44100,
      queued: false,
    });
    expect(lastRequest).toBeDefined();
    expect(JSON.parse(String(lastRequest))).toMatchObject({
      transcript: 'Second',
    });
  });

  test('stop is a no-op when no speech is active', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.stop();

    expect(events).toEqual([]);
  });

  test('throws a classified parse error when speak is called without any voice id', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
    });

    await provider.connect();
    expect(() => provider.speak('Hello')).toThrow('Voice ID is required');
  });

  test('clears turn state after provider error so a new speak emits started again', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    const firstHandle = provider.speak('First');

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(JSON.stringify({ error: 'boom' }));

    const secondHandle = provider.speak('Second');
    await expect(firstHandle.completion).resolves.toBe('stopped');

    expect(secondHandle.speech).toEqual({
      text: 'Second',
      format: 'pcm_f32le',
      sampleRate: 44100,
      queued: false,
    });
    expect(events).toHaveLength(1);
  });

  test('emits provider error messages from the websocket', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(JSON.stringify({ error: 'cartesia boom' }));

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('unknown');
      expect(lastEvent.error.message).toBe('cartesia boom');
    }
  });

  test('emits an error when the websocket payload is not a JSON object', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage('"not-an-object"');

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('parse');
      expect(lastEvent.error.message).toContain(
        'Cartesia message must be a JSON object',
      );
    }
  });

  test('emits an error when the websocket payload has invalid field types', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(
      JSON.stringify({
        type: 'chunk',
        data: 123,
      }),
    );

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('parse');
      expect(lastEvent.error.message).toContain(
        'Cartesia message field `data` must be a string',
      );
    }
  });

  test('emits a classified transport error before disconnect when the websocket closes unexpectedly mid-speech', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.speak('Hello');

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateClose(1011, 'upstream failure');

    const errorEvent = events.at(-2);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.kind).toBe('transport');
      expect(errorEvent.error.provider).toBe('cartesia');
      expect(errorEvent.error.message).toBe(
        'Cartesia WebSocket closed unexpectedly (1011: upstream failure)',
      );
    }
    expect(events.at(-1)).toEqual({
      type: 'disconnected',
      clean: false,
      reason: 'transport_lost',
      message:
        'Cartesia WebSocket closed unexpectedly (1011: upstream failure)',
    });
  });

  test('settles the active handle and emits an error when speak send throws', async () => {
    globalThis.WebSocket = ThrowOnSendWebSocket as unknown as typeof WebSocket;

    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    expect(() => provider.speak('Hello')).toThrow(
      'Cartesia WebSocket send failed',
    );
    const errorEvent = events.at(-1);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.kind).toBe('transport');
      expect(errorEvent.error.message).toBe('Cartesia WebSocket send failed');
      expect((errorEvent.error.cause as Error | undefined)?.message).toBe(
        'mock cartesia send failure',
      );
    }
  });

  test('listener failures do not block later Cartesia listeners', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const received: TTSEvent[] = [];

    provider.onEvent(() => {
      throw new Error('cartesia listener exploded');
    });
    provider.onEvent((event) => {
      received.push(event);
    });

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(
      JSON.stringify({
        type: 'chunk',
        data: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('chunk');
  });
});
