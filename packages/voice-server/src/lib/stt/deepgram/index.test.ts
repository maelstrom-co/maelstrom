import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { AudioChunk, STTEvent, TranscriptionResult } from '../../types.js';
import { createDeepgramSTT } from './index.js';

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
  sentMessages: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

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

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close'));
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  simulateError() {
    this.onerror?.(new Event('error'));
  }
}

const OriginalWebSocket = globalThis.WebSocket;

describe('createDeepgramSTT', () => {
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    process.env.DEEPGRAM_API_KEY = mockApiKey;
    MockWebSocket.instances = [];
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    delete process.env.DEEPGRAM_API_KEY;
    globalThis.WebSocket = OriginalWebSocket;
  });

  test('reports the expected capabilities', () => {
    const provider = createDeepgramSTT();
    expect(provider.capabilities).toEqual({
      interimTranscripts: true,
    });
  });

  test('connects and uses the configured language', async () => {
    const provider = createDeepgramSTT({
      apiKey: mockApiKey,
      interimResults: false,
    });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect({ language: 'es' });

    const mockWs = MockWebSocket.instances.at(-1);
    expect(provider.isConnected()).toBe(true);
    expect(events).toContainEqual({ type: 'connected' });
    expect(mockWs?.url).toContain('language=es');
    expect(mockWs?.url).toContain('interim_results=false');
    expect(mockWs?.options?.headers).toEqual({
      Authorization: `Token ${mockApiKey}`,
    });
    expect(provider.capabilities.interimTranscripts).toBe(false);
  });

  test('uses docs-backed websocket query and transport options', async () => {
    const provider = createDeepgramSTT({
      apiKey: mockApiKey,
      baseUrl: 'wss://api.eu.deepgram.com',
      vadEvents: true,
      endpointing: 400,
      utteranceEndMs: 1500,
      connectionTimeoutInSeconds: 2,
    });

    await provider.connect({ language: 'en' });

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.url).toContain('wss://api.eu.deepgram.com/v1/listen?');
    expect(mockWs?.url).toContain('vad_events=true');
    expect(mockWs?.url).toContain('endpointing=400');
    expect(mockWs?.url).toContain('utterance_end_ms=1500');
  });

  test('does not send utterance_end_ms when interim results are disabled', async () => {
    const provider = createDeepgramSTT({
      apiKey: mockApiKey,
      interimResults: false,
      utteranceEndMs: 1500,
    });

    await provider.connect({ language: 'en' });

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.url).not.toContain('utterance_end_ms=1500');
  });

  test('merges static and dynamic keyterms into repeated query params', async () => {
    const provider = createDeepgramSTT({
      apiKey: mockApiKey,
      keyterms: ['glucose'],
      keytermsProvider: async () => ['hemoglobin'],
    });

    await provider.connect({ language: 'en' });

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.url).toContain('keyterm=glucose');
    expect(mockWs?.url).toContain('keyterm=hemoglobin');
  });

  test('emits transcript results with confidence', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    const transcripts: TranscriptionResult[] = [];

    provider.onEvent((event) => {
      if (event.type === 'transcript') {
        transcripts.push(event.result);
      }
    });

    await provider.connect();
    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(
      JSON.stringify({
        type: 'Results',
        channel: {
          alternatives: [
            {
              transcript: 'Hello world',
              confidence: 0.95,
            },
          ],
          detected_language: 'en',
        },
        is_final: true,
        duration: 1.5,
      }),
    );

    expect(transcripts).toEqual([
      {
        text: 'Hello world',
        isFinal: true,
        confidence: 0.95,
        language: 'en',
        durationInSeconds: 1.5,
      },
    ]);
  });

  test('reports malformed Results payloads instead of silently coercing them', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(
      JSON.stringify({
        type: 'Results',
        channel: { alternatives: [{ transcript: 'hello world' }] },
        is_final: 'true',
      }),
    );

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('parse');
      expect(lastEvent.error.provider).toBe('deepgram');
      expect(lastEvent.error.message).toContain('is_final');
    }
  });

  test('sends audio after connecting', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    await provider.connect();

    const chunk: AudioChunk = {
      data: new Uint8Array([1, 2, 3]),
      sampleRate: 16000,
      encoding: 'linear16',
      timestamp: Date.now(),
    };
    provider.sendAudio(chunk);

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.sentMessages).toHaveLength(1);
    expect(mockWs?.sentMessages[0]).toEqual(chunk.data);
  });

  test('rejects non-linear16 input instead of forwarding unsupported audio', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.sendAudio({
      data: new Uint8Array([1, 2, 3]),
      sampleRate: 16000,
      encoding: 'opus',
      timestamp: Date.now(),
    });

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.sentMessages).toHaveLength(0);
    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('parse');
      expect(lastEvent.error.message).toContain('linear16');
    }
  });

  test('rejects sample-rate mismatches instead of forwarding malformed audio', async () => {
    const provider = createDeepgramSTT({
      apiKey: mockApiKey,
      sampleRate: 16000,
    });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    provider.sendAudio({
      data: new Uint8Array([1, 2, 3]),
      sampleRate: 8000,
      encoding: 'linear16',
      timestamp: Date.now(),
    });

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.sentMessages).toHaveLength(0);
    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('parse');
      expect(lastEvent.error.message).toContain('sampleRate 16000');
    }
  });

  test('endStream sends an empty chunk terminator', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    await provider.connect();

    provider.sendAudio({
      data: new Uint8Array([1, 2, 3]),
      sampleRate: 16000,
      encoding: 'linear16',
      timestamp: Date.now(),
    });
    provider.endStream();

    const mockWs = MockWebSocket.instances.at(-1);
    expect(mockWs?.sentMessages.at(-1)).toEqual(new Uint8Array(0));
  });

  test('emits provider transport errors', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateError();

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('transport');
      expect(lastEvent.error.message).toBe('Deepgram WebSocket error');
    }
  });

  test('emits provider error messages from non-Results websocket frames', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateMessage(
      JSON.stringify({
        type: 'Error',
        err_msg: 'Bad Request: failed to process audio',
      }),
    );

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('error');
    if (lastEvent?.type === 'error') {
      expect(lastEvent.error.kind).toBe('parse');
      expect(lastEvent.error.message).toBe(
        'Bad Request: failed to process audio',
      );
    }
  });

  test('treats the known idle-timeout close reason as a recoverable disconnect', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateClose(1011, 'NET-0000');

    expect(events).toEqual([{ type: 'connected' }, { type: 'disconnected' }]);
  });

  test('emits non-idle abnormal close reasons as provider errors before disconnecting', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();

    const mockWs = MockWebSocket.instances.at(-1);
    mockWs?.simulateClose(1011, 'upstream failure');

    const errorEvent = events.at(-2);
    expect(errorEvent?.type).toBe('error');
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.kind).toBe('transport');
      expect(errorEvent.error.message).toBe(
        'Deepgram WebSocket closed unexpectedly (1011): upstream failure',
      );
    }
    expect(events.at(-1)).toEqual({ type: 'disconnected' });
  });

  test('can reconnect after disconnect', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });

    await provider.connect();
    const firstSocket = MockWebSocket.instances.at(-1);
    await provider.disconnect();
    await provider.connect();

    const secondSocket = MockWebSocket.instances.at(-1);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(secondSocket).toBeDefined();
    expect(secondSocket).not.toBe(firstSocket);
  });

  test('disconnect emits disconnected only once', async () => {
    const provider = createDeepgramSTT({ apiKey: mockApiKey });
    const events: STTEvent[] = [];
    provider.onEvent((event) => events.push(event));

    await provider.connect();
    await provider.disconnect();

    expect(
      events.filter((event) => event.type === 'disconnected'),
    ).toHaveLength(1);
  });
});
