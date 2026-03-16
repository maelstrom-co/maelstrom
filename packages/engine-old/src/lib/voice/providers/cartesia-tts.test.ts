/**
 * Tests for Cartesia TTS provider
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { SpeechChunk, TTSEvent } from '../types.js';
import type { CartesiaSpeechOptions } from './cartesia-tts.js';
import { createCartesiaTTS } from './cartesia-tts.js';

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

  public sentMessages: string[] = [];

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(data: string) {
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

describe('Cartesia TTS Provider', () => {
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    process.env.CARTESIA_API_KEY = mockApiKey;
  });

  afterEach(() => {
    delete process.env.CARTESIA_API_KEY;
  });

  describe('createCartesiaTTS', () => {
    it('should create provider with API key from environment', () => {
      const provider = createCartesiaTTS();
      expect(provider.name).toBe('cartesia');
    });

    it('should create provider with explicit API key', () => {
      const provider = createCartesiaTTS({ apiKey: 'explicit-key' });
      expect(provider.name).toBe('cartesia');
    });

    it('should throw error when no API key provided', () => {
      delete process.env.CARTESIA_API_KEY;
      expect(() => createCartesiaTTS()).toThrow('Cartesia API key is required');
    });
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      const provider = createCartesiaTTS({ apiKey: mockApiKey });
      const events: TTSEvent[] = [];

      provider.onEvent((event) => events.push(event));

      await provider.connect();

      expect(provider.isConnected()).toBe(true);
      expect(events).toContainEqual({ type: 'connected' });
    });

    it('should not reconnect if already connected', async () => {
      const provider = createCartesiaTTS({ apiKey: mockApiKey });

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
      const provider = createCartesiaTTS({ apiKey: mockApiKey });
      const events: TTSEvent[] = [];

      provider.onEvent((event) => events.push(event));

      await provider.connect();
      expect(provider.isConnected()).toBe(true);

      await provider.disconnect();

      expect(provider.isConnected()).toBe(false);
      expect(events).toContainEqual({ type: 'disconnected' });
    });

    it('should stop speaking when disconnected', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });

      await provider.connect();
      provider.speak('Hello world');

      // Wait for speech to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(provider.isSpeaking()).toBe(true);

      await provider.disconnect();

      expect(provider.isSpeaking()).toBe(false);
    });
  });

  describe('speak', () => {
    it('should start speaking', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });
      const events: TTSEvent[] = [];

      provider.onEvent((event) => events.push(event));

      await provider.connect();
      provider.speak('Hello world');

      // Wait for started event
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(provider.isSpeaking()).toBe(true);
      expect(events).toContainEqual({ type: 'started', text: 'Hello world' });
    });

    it('should emit error when not connected', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });
      const events: TTSEvent[] = [];

      provider.onEvent((event) => events.push(event));

      // Don't connect
      provider.speak('Hello world');

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });

    it('should emit error when no voice ID', async () => {
      const provider = createCartesiaTTS({ apiKey: mockApiKey });
      // No defaultVoiceId provided
      const events: TTSEvent[] = [];

      provider.onEvent((event) => events.push(event));

      await provider.connect();
      provider.speak('Hello world');

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });

    it('should use voice from options', async () => {
      const provider = createCartesiaTTS({ apiKey: mockApiKey });
      const events: TTSEvent[] = [];

      provider.onEvent((event) => events.push(event));

      await provider.connect();

      const options: CartesiaSpeechOptions = {
        voice: 'custom-voice',
      };
      provider.speak('Hello world', options);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(provider.isSpeaking()).toBe(true);
    });
  });

  describe('audio chunks', () => {
    it('should receive audio chunks', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });
      const chunks: SpeechChunk[] = [];

      provider.onEvent((event) => {
        if (event.type === 'chunk') {
          chunks.push(event.chunk);
        }
      });

      await provider.connect();
      provider.speak('Hello');

      // Simulate receiving audio chunk
      const mockWs = (provider as any).ws;
      if (mockWs) {
        // Create base64 encoded audio data
        const audioData = new Uint8Array([1, 2, 3, 4, 5]);
        const base64 = btoa(String.fromCharCode(...audioData));

        mockWs.simulateMessage(
          JSON.stringify({
            type: 'chunk',
            data: base64,
          }),
        );
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].format).toBe('pcm_f32le');
      expect(chunks[0].sampleRate).toBe(44100);
    });

    it('should receive final chunk on completion', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });
      const chunks: SpeechChunk[] = [];

      provider.onEvent((event) => {
        if (event.type === 'chunk') {
          chunks.push(event.chunk);
        }
      });

      await provider.connect();
      provider.speak('Hello');

      // Simulate completion
      const mockWs = (provider as any).ws;
      if (mockWs) {
        mockWs.simulateMessage(
          JSON.stringify({
            done: true,
          }),
        );
      }

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 10));

      const finalChunk = chunks.find((c) => c.isFinal);
      expect(finalChunk).toBeDefined();
    });
  });

  describe('streaming with continue flag', () => {
    it('should continue on same context', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });

      await provider.connect();

      // First part
      provider.speak('Hello,', { continue: true } as CartesiaSpeechOptions);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second part
      provider.speak(' how are you?', {
        continue: true,
      } as CartesiaSpeechOptions);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Final part
      provider.speak(' Goodbye!', { continue: false } as CartesiaSpeechOptions);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // All should be on the same context
      const mockWs = (provider as any).ws;
      if (mockWs && mockWs.sentMessages.length >= 3) {
        const msg1 = JSON.parse(mockWs.sentMessages[0]);
        const msg2 = JSON.parse(mockWs.sentMessages[1]);
        const msg3 = JSON.parse(mockWs.sentMessages[2]);

        expect(msg1.context_id).toBeDefined();
        expect(msg2.context_id).toBe(msg1.context_id);
        expect(msg3.context_id).toBe(msg1.context_id);

        expect(msg1.continue).toBe(true);
        expect(msg2.continue).toBe(true);
        expect(msg3.continue).toBe(false);
      }
    });

    it('should create new context when previous context expires', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });

      await provider.connect();

      // First message
      provider.speak('First message', {
        continue: false,
      } as CartesiaSpeechOptions);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate completion of first message
      const mockWs = (provider as any).ws;
      if (mockWs) {
        mockWs.simulateMessage(JSON.stringify({ done: true }));
      }

      // Wait for context to expire (1 second after completion)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Second message (should create new context)
      provider.speak('Second message', {
        continue: false,
      } as CartesiaSpeechOptions);
      await new Promise((resolve) => setTimeout(resolve, 10));

      if (mockWs && mockWs.sentMessages.length >= 2) {
        const msg1 = JSON.parse(mockWs.sentMessages[0]);
        const msg2 = JSON.parse(mockWs.sentMessages[1]);

        // Context IDs should be different
        expect(msg1.context_id).not.toBe(msg2.context_id);
      }
    });
  });

  describe('stop', () => {
    it('should stop speaking', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });
      const events: TTSEvent[] = [];

      provider.onEvent((event) => events.push(event));

      await provider.connect();
      provider.speak('Hello world');

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(provider.isSpeaking()).toBe(true);

      provider.stop();

      expect(provider.isSpeaking()).toBe(false);
      expect(events).toContainEqual({ type: 'stopped' });
    });

    it('should send cancel message', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });

      await provider.connect();
      provider.speak('Hello world');

      await new Promise((resolve) => setTimeout(resolve, 10));

      provider.stop();

      const mockWs = (provider as any).ws;
      if (mockWs) {
        const cancelMessages = mockWs.sentMessages.filter((msg: string) => {
          try {
            const parsed = JSON.parse(msg);
            return parsed.cancel === true;
          } catch {
            return false;
          }
        });

        expect(cancelMessages.length).toBeGreaterThan(0);
      }
    });

    it('should not error when not speaking', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });

      await provider.connect();

      // Don't start speaking
      expect(() => provider.stop()).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle WebSocket errors', async () => {
      const provider = createCartesiaTTS({ apiKey: mockApiKey });
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

    it('should handle error messages from server', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });
      const errors: Error[] = [];

      provider.onEvent((event) => {
        if (event.type === 'error') {
          errors.push(event.error);
        }
      });

      await provider.connect();
      provider.speak('Hello');

      const mockWs = (provider as any).ws;
      if (mockWs) {
        mockWs.simulateMessage(
          JSON.stringify({
            error: 'Invalid voice ID',
          }),
        );
      }

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('onEvent', () => {
    it('should allow multiple listeners', async () => {
      const provider = createCartesiaTTS({ apiKey: mockApiKey });
      const events1: TTSEvent[] = [];
      const events2: TTSEvent[] = [];

      provider.onEvent((event) => events1.push(event));
      provider.onEvent((event) => events2.push(event));

      await provider.connect();

      expect(events1).toContainEqual({ type: 'connected' });
      expect(events2).toContainEqual({ type: 'connected' });
    });

    it('should allow unsubscribing', async () => {
      const provider = createCartesiaTTS({ apiKey: mockApiKey });
      const events: TTSEvent[] = [];

      const unsubscribe = provider.onEvent((event) => events.push(event));
      unsubscribe();

      await provider.connect();

      expect(events).toHaveLength(0);
    });
  });

  describe('configuration options', () => {
    it('should use default model', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });

      await provider.connect();
      provider.speak('Hello');

      const mockWs = (provider as any).ws;
      if (mockWs && mockWs.sentMessages.length > 0) {
        const msg = JSON.parse(mockWs.sentMessages[0]);
        expect(msg.model_id).toBe('sonic-3');
      }
    });

    it('should use custom model', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
        modelId: 'sonic-2',
      });

      await provider.connect();
      provider.speak('Hello');

      const mockWs = (provider as any).ws;
      if (mockWs && mockWs.sentMessages.length > 0) {
        const msg = JSON.parse(mockWs.sentMessages[0]);
        expect(msg.model_id).toBe('sonic-2');
      }
    });

    it('should use default language', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });

      await provider.connect();
      provider.speak('Hello');

      const mockWs = (provider as any).ws;
      if (mockWs && mockWs.sentMessages.length > 0) {
        const msg = JSON.parse(mockWs.sentMessages[0]);
        expect(msg.language).toBe('en');
      }
    });

    it('should use custom language', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
        language: 'es',
      });

      await provider.connect();
      provider.speak('Hola');

      const mockWs = (provider as any).ws;
      if (mockWs && mockWs.sentMessages.length > 0) {
        const msg = JSON.parse(mockWs.sentMessages[0]);
        expect(msg.language).toBe('es');
      }
    });

    it('should use custom sample rate', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
        sampleRate: 16000,
      });

      await provider.connect();
      provider.speak('Hello');

      const mockWs = (provider as any).ws;
      if (mockWs && mockWs.sentMessages.length > 0) {
        const msg = JSON.parse(mockWs.sentMessages[0]);
        expect(msg.output_format.sample_rate).toBe(16000);
      }
    });

    it('should pass speed option', async () => {
      const provider = createCartesiaTTS({
        apiKey: mockApiKey,
        defaultVoiceId: 'test-voice',
      });

      await provider.connect();
      provider.speak('Hello', { speed: 1.2 });

      const mockWs = (provider as any).ws;
      if (mockWs && mockWs.sentMessages.length > 0) {
        const msg = JSON.parse(mockWs.sentMessages[0]);
        expect(msg.speed).toBe(1.2);
      }
    });
  });
});
