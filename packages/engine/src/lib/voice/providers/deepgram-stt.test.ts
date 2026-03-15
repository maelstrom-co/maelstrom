/**
 * Tests for Deepgram STT provider
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { AudioChunk, STTEvent, TranscriptionResult } from '../types.js';
import { createDeepgramSTT } from './deepgram-stt.js';

// Mock WebSocket
global.WebSocket = class MockWebSocket {
  public readyState = 0; // CONNECTING
  public static CONNECTING = 0;
  public static OPEN = 1;
  public static CLOSING = 2;
  public static CLOSED = 3;

  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;

  public sentMessages: (string | ArrayBufferLike | Blob | ArrayBufferView)[] =
    [];

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  // Helper method to simulate receiving messages
  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
} as any;

describe('Deepgram STT Provider', () => {
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    // Set environment variable
    process.env.DEEPGRAM_API_KEY = mockApiKey;
  });

  afterEach(() => {
    delete process.env.DEEPGRAM_API_KEY;
  });

  describe('createDeepgramSTT', () => {
    it('should create provider with API key from environment', () => {
      const provider = createDeepgramSTT();
      expect(provider.name).toBe('deepgram');
    });

    it('should create provider with explicit API key', () => {
      const provider = createDeepgramSTT({ apiKey: 'explicit-key' });
      expect(provider.name).toBe('deepgram');
    });

    it('should throw error when no API key provided', () => {
      delete process.env.DEEPGRAM_API_KEY;
      expect(() => createDeepgramSTT()).toThrow('Deepgram API key is required');
    });
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const events: STTEvent[] = [];

      provider.onEvent((event) => events.push(event));

      await provider.connect();

      expect(provider.isConnected()).toBe(true);
      expect(events).toContainEqual({ type: 'connected' });
    });

    it('should connect with custom language', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });

      await provider.connect({ language: 'es' });

      expect(provider.isConnected()).toBe(true);
    });

    it('should not reconnect if already connected', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });

      await provider.connect();
      const firstConnect = provider.isConnected();

      await provider.connect();
      const secondConnect = provider.isConnected();

      expect(firstConnect).toBe(true);
      expect(secondConnect).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const events: STTEvent[] = [];

      provider.onEvent((event) => events.push(event));

      await provider.connect();
      expect(provider.isConnected()).toBe(true);

      await provider.disconnect();

      expect(provider.isConnected()).toBe(false);
      expect(events).toContainEqual({ type: 'disconnected' });
    });
  });

  describe('sendAudio', () => {
    it('should send audio chunks', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });

      await provider.connect();

      const chunk: AudioChunk = {
        data: new Uint8Array([1, 2, 3, 4, 5]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: Date.now(),
      };

      provider.sendAudio(chunk);

      expect(provider.isListening()).toBe(true);
    });

    it('should emit error when not connected', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const events: STTEvent[] = [];

      provider.onEvent((event) => events.push(event));

      // Don't connect

      const chunk: AudioChunk = {
        data: new Uint8Array([1, 2, 3]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: Date.now(),
      };

      provider.sendAudio(chunk);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });
  });

  describe('endStream', () => {
    it('should end stream and stop listening', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });

      await provider.connect();

      const chunk: AudioChunk = {
        data: new Uint8Array([1, 2, 3]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: Date.now(),
      };

      provider.sendAudio(chunk);
      expect(provider.isListening()).toBe(true);

      provider.endStream();
      expect(provider.isListening()).toBe(false);
    });
  });

  describe('transcript events', () => {
    it('should handle transcript results', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const transcripts: TranscriptionResult[] = [];

      provider.onEvent((event) => {
        if (event.type === 'transcript') {
          transcripts.push(event.result);
        }
      });

      await provider.connect();

      // Simulate transcript message from Deepgram
      const mockWs = (provider as any).ws;
      if (mockWs) {
        mockWs.simulateMessage(
          JSON.stringify({
            type: 'Results',
            channel: {
              alternatives: [
                {
                  transcript: 'Hello world',
                  confidence: 0.95,
                },
              ],
            },
            is_final: true,
            duration: 1.5,
          }),
        );
      }

      expect(transcripts).toHaveLength(1);
      expect(transcripts[0].text).toBe('Hello world');
      expect(transcripts[0].isFinal).toBe(true);
      expect(transcripts[0].confidence).toBe(0.95);
    });

    it('should handle interim transcripts', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const transcripts: TranscriptionResult[] = [];

      provider.onEvent((event) => {
        if (event.type === 'transcript') {
          transcripts.push(event.result);
        }
      });

      await provider.connect();

      const mockWs = (provider as any).ws;
      if (mockWs) {
        mockWs.simulateMessage(
          JSON.stringify({
            type: 'Results',
            channel: {
              alternatives: [
                {
                  transcript: 'Hello',
                  confidence: 0.8,
                },
              ],
            },
            is_final: false,
            duration: 0.5,
          }),
        );
      }

      expect(transcripts).toHaveLength(1);
      expect(transcripts[0].text).toBe('Hello');
      expect(transcripts[0].isFinal).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle WebSocket errors', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const errors: Error[] = [];

      provider.onEvent((event) => {
        if (event.type === 'error') {
          errors.push(event.error);
        }
      });

      await provider.connect();

      const mockWs = (provider as any).ws;
      if (mockWs) {
        mockWs.simulateError();
      }

      expect(errors.length).toBeGreaterThan(0);
    });

    it('should handle malformed messages', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const errors: Error[] = [];

      provider.onEvent((event) => {
        if (event.type === 'error') {
          errors.push(event.error);
        }
      });

      await provider.connect();

      const mockWs = (provider as any).ws;
      if (mockWs) {
        mockWs.simulateMessage('invalid json');
      }

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('onEvent', () => {
    it('should allow multiple listeners', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const events1: STTEvent[] = [];
      const events2: STTEvent[] = [];

      provider.onEvent((event) => events1.push(event));
      provider.onEvent((event) => events2.push(event));

      await provider.connect();

      expect(events1).toContainEqual({ type: 'connected' });
      expect(events2).toContainEqual({ type: 'connected' });
    });

    it('should allow unsubscribing', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      const events: STTEvent[] = [];

      const unsubscribe = provider.onEvent((event) => events.push(event));
      unsubscribe();

      await provider.connect();

      expect(events).toHaveLength(0);
    });
  });

  describe('configuration options', () => {
    it('should use default model', async () => {
      const provider = createDeepgramSTT({ apiKey: mockApiKey });
      await provider.connect();

      // The WebSocket URL should contain the model
      const mockWs = (provider as any).ws;
      expect(mockWs.url).toContain('model=nova-3');
    });

    it('should use custom model', async () => {
      const provider = createDeepgramSTT({
        apiKey: mockApiKey,
        model: 'nova-2',
      });
      await provider.connect();

      const mockWs = (provider as any).ws;
      expect(mockWs.url).toContain('model=nova-2');
    });

    it('should disable interim results', async () => {
      const provider = createDeepgramSTT({
        apiKey: mockApiKey,
        interimResults: false,
      });
      await provider.connect();

      const mockWs = (provider as any).ws;
      expect(mockWs.url).toContain('interim_results=false');
    });

    it('should append fixed keyterms to websocket query', async () => {
      const provider = createDeepgramSTT({
        apiKey: mockApiKey,
        keyterms: ['vessel', 'split view'],
      });

      await provider.connect();

      const mockWs = (provider as any).ws;
      expect(mockWs.url).toContain('keyterm=vessel');
      expect(mockWs.url).toContain('keyterm=split+view');
    });

    it('should append dynamic keyterms from provider', async () => {
      const provider = createDeepgramSTT({
        apiKey: mockApiKey,
        keytermsProvider: async () => ['chart', 'layout'],
      });

      await provider.connect();

      const mockWs = (provider as any).ws;
      expect(mockWs.url).toContain('keyterm=chart');
      expect(mockWs.url).toContain('keyterm=layout');
    });
  });
});
