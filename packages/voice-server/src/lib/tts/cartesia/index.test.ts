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
    this.onclose?.(new CloseEvent('close'));
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
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

  test('connects and emits connected', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    expect(provider.isConnected()).toBe(true);
    expect(events).toContainEqual({ type: 'connected' });
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
    provider.speak('Hello');

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(
      JSON.stringify({
        type: 'chunk',
        data: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
      }),
    );
    mockWs?.simulateMessage(JSON.stringify({ done: true }));

    expect(events[0]).toEqual({ type: 'connected' });
    expect(events[1]).toEqual({
      type: 'started',
      speech: {
        text: 'Hello',
        format: 'pcm_f32le',
        sampleRate: 44100,
      },
    });
    expect(events[2]?.type).toBe('chunk');
    expect(events[3]?.type).toBe('chunk');
    expect(events[4]).toEqual({ type: 'completed' });
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
  });

  test('stop sends a cancel message for the active context and emits stopped', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.speak('Hello');
    provider.stop();

    const mockWs = MockWebSocket.instances.at(-1);
    const cancelMessage = mockWs?.sentMessages.at(-1);
    expect(cancelMessage).toBeDefined();
    expect(typeof cancelMessage).toBe('string');
    expect(JSON.parse(String(cancelMessage))).toMatchObject({ cancel: true });
    expect(events.at(-1)).toEqual({ type: 'stopped' });
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

    expect(events).not.toContainEqual({ type: 'stopped' });
  });

  test('emits an error when speak is called without any voice id', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.speak('Hello');

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.message).toBe('Voice ID is required');
    }
  });

  test('clears turn state after provider error so a new speak emits started again', async () => {
    const provider = createCartesiaTTS({
      apiKey: mockApiKey,
      defaultVoiceId: 'voice-1',
    });
    const events: TTSEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.speak('First');

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(JSON.stringify({ error: 'boom' }));

    provider.speak('Second');

    expect(events.filter((event) => event.type === 'started')).toHaveLength(2);
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
      expect(lastEvent.error.message).toContain(
        'Cartesia message field `data` must be a string',
      );
    }
  });
});
