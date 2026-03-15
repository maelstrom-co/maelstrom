/**
 * Tests for voice engine implementation
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { LLMProvider } from '../types.js';
import type {
  AudioChunk,
  STTEvent,
  STTProvider,
  TranscriptionResult,
  TTSEvent,
  TTSProvider,
} from './types.js';
import type { VoiceEngineConfig } from './voice-engine.js';
import { createVoiceEngine, isVoiceEngine } from './voice-engine.js';

// Mock LLM Provider
const createMockLLMProvider = (): LLMProvider => ({
  complete: async () => ({
    userMessage: 'Hello!',
    rationale: 'Test rationale',
    executionPlan: [],
    layout: { tree: [], instances: [] },
  }),
});

// Mock STT Provider
const createMockSTTProvider = (): STTProvider & {
  simulateEvent: (event: STTEvent) => void;
  simulateTranscript: (text: string, isFinal: boolean) => void;
} => {
  const listeners = new Set<(event: STTEvent) => void>();
  let connected = false;
  let listening = false;

  return {
    name: 'mock-stt',

    async connect() {
      connected = true;
      listeners.forEach((cb) => {
        cb({ type: 'connected' });
      });
    },

    async disconnect() {
      connected = false;
      listening = false;
      listeners.forEach((cb) => {
        cb({ type: 'disconnected' });
      });
    },

    sendAudio(_chunk: AudioChunk) {
      listening = true;
    },

    endStream() {
      listening = false;
    },

    onEvent(callback: (event: STTEvent) => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    isConnected() {
      return connected;
    },

    isListening() {
      return listening;
    },

    simulateEvent(event: STTEvent) {
      listeners.forEach((cb) => {
        cb(event);
      });
    },

    simulateTranscript(text: string, isFinal: boolean) {
      const result: TranscriptionResult = {
        text,
        isFinal,
        confidence: 0.95,
      };
      listeners.forEach((cb) => {
        cb({ type: 'transcript', result });
      });
    },
  };
};

// Mock TTS Provider
const createMockTTSProvider = (): TTSProvider & {
  simulateEvent: (event: TTSEvent) => void;
  simulateComplete: () => void;
} => {
  const listeners = new Set<(event: TTSEvent) => void>();
  let connected = false;
  let speaking = false;

  return {
    name: 'mock-tts',

    async connect() {
      connected = true;
      listeners.forEach((cb) => {
        cb({ type: 'connected' });
      });
    },

    async disconnect() {
      connected = false;
      speaking = false;
      listeners.forEach((cb) => {
        cb({ type: 'disconnected' });
      });
    },

    speak(text: string) {
      speaking = true;
      listeners.forEach((cb) => {
        cb({ type: 'started', text });
      });

      // Simulate completion after a short delay
      setTimeout(() => {
        if (speaking) {
          speaking = false;
          listeners.forEach((cb) => {
            cb({ type: 'completed' });
          });
        }
      }, 10);
    },

    stop() {
      if (speaking) {
        speaking = false;
        listeners.forEach((cb) => {
          cb({ type: 'stopped' });
        });
      }
    },

    onEvent(callback: (event: TTSEvent) => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    isConnected() {
      return connected;
    },

    isSpeaking() {
      return speaking;
    },

    simulateEvent(event: TTSEvent) {
      listeners.forEach((cb) => {
        cb(event);
      });
    },

    simulateComplete() {
      speaking = false;
      listeners.forEach((cb) => {
        cb({ type: 'completed' });
      });
    },
  };
};

describe('Voice Engine', () => {
  let mockSTT: ReturnType<typeof createMockSTTProvider>;
  let mockTTS: ReturnType<typeof createMockTTSProvider>;
  let mockLLM: LLMProvider;

  beforeEach(() => {
    mockSTT = createMockSTTProvider();
    mockTTS = createMockTTSProvider();
    mockLLM = createMockLLMProvider();
  });

  afterEach(async () => {
    await mockSTT.disconnect();
    await mockTTS.disconnect();
  });

  describe('createVoiceEngine', () => {
    it('should create a voice-enabled engine', () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
          mode: 'continuous',
        },
      };

      const engine = createVoiceEngine(config);

      expect(engine).toBeDefined();
      expect(isVoiceEngine(engine)).toBe(true);
    });

    it('should initialize in idle state', () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      expect(engine.getVoiceState()).toBe('idle');
    });
  });

  describe('isVoiceEngine', () => {
    it('should return true for voice engine', () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      expect(isVoiceEngine(engine)).toBe(true);
    });

    it('should return false for regular engine', () => {
      const regularEngine = {
        process: async () => ({}),
      };

      expect(isVoiceEngine(regularEngine as any)).toBe(false);
    });
  });

  describe('startListening', () => {
    it('should transition from idle to listening', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      expect(engine.getVoiceState()).toBe('idle');

      await engine.startListening();

      expect(engine.getVoiceState()).toBe('listening');
      expect(mockSTT.isConnected()).toBe(true);
    });

    it('should connect providers on first start', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      expect(mockSTT.isConnected()).toBe(false);
      expect(mockTTS.isConnected()).toBe(false);

      await engine.startListening();

      expect(mockSTT.isConnected()).toBe(true);
      expect(mockTTS.isConnected()).toBe(true);
    });

    it('is idempotent when already listening', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      await engine.startListening();
      await expect(engine.startListening()).resolves.toBeUndefined();
      expect(engine.getVoiceState()).toBe('listening');
    });
  });

  describe('stopListening', () => {
    it('should transition to processing when speech was received', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
          mode: 'continuous',
        },
      };

      const engine = createVoiceEngine(config);

      await engine.startListening();

      // Simulate speech
      mockSTT.simulateTranscript('Hello', true);

      await engine.stopListening();

      // In continuous mode with final transcript, should go to processing
      expect(engine.getVoiceState()).toBe('processing');
    });
  });

  describe('interrupt', () => {
    it('should stop speaking when interrupted', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      // Connect providers first
      await engine.startListening();
      await engine.stopListening();

      // Start speaking
      engine.speak('Hello world');

      // Wait for started event
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(engine.getVoiceState()).toBe('speaking');

      engine.interrupt();

      expect(engine.getVoiceState()).toBe('idle');
    });

    it('should stop listening when interrupted', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      await engine.startListening();
      expect(engine.getVoiceState()).toBe('listening');

      engine.interrupt();

      expect(engine.getVoiceState()).toBe('idle');
    });
  });

  describe('voice state callbacks', () => {
    it('should call onVoiceStateChange when state changes', async () => {
      const stateChanges: string[] = [];

      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config, {
        onVoiceStateChange: (state) => {
          stateChanges.push(state);
        },
      });

      await engine.startListening();

      expect(stateChanges).toContain('listening');
    });

    it('should allow unsubscribing from state changes', async () => {
      const stateChanges: string[] = [];

      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      const unsubscribe = engine.onVoiceStateChange((state) => {
        stateChanges.push(state);
      });

      // Unsubscribe immediately
      unsubscribe();

      await engine.startListening();

      expect(stateChanges).toHaveLength(0);
    });
  });

  describe('transcript callbacks', () => {
    it('should receive transcript events', async () => {
      const transcripts: TranscriptionResult[] = [];

      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
          mode: 'continuous',
        },
      };

      const engine = createVoiceEngine(config, {
        onTranscript: (result) => {
          transcripts.push(result);
        },
      });

      await engine.startListening();

      mockSTT.simulateTranscript('Hello', true);
      mockSTT.simulateTranscript('world', true);

      expect(transcripts).toHaveLength(2);
      expect(transcripts[0].text).toBe('Hello');
      expect(transcripts[0].isFinal).toBe(false);
      expect(transcripts[1].text).toBe('Hello world');
      expect(transcripts[1].isFinal).toBe(false);

      // TODO add VAD external tests here
    });
  });

  describe('speak', () => {
    it('should start speaking', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      // Connect providers first
      await engine.startListening();
      await engine.stopListening();

      engine.speak('Hello world');

      // Wait for async started event
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(engine.getVoiceState()).toBe('speaking');
    });

    it('should stop current speech before starting new speech', async () => {
      const stoppedEvents: boolean[] = [];

      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config, {
        onSpeechStopped: (completed) => {
          stoppedEvents.push(completed);
        },
      });

      // Connect providers first
      await engine.startListening();
      await engine.stopListening();

      engine.speak('First message');
      await new Promise((resolve) => setTimeout(resolve, 5));

      engine.speak('Second message');
      await new Promise((resolve) => setTimeout(resolve, 5));

      // First speech should have been stopped (not completed)
      expect(stoppedEvents).toContain(false);
    });
  });

  describe('auto-restart in continuous mode', () => {
    it('should not indicate auto-restart when disabled', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
          mode: 'continuous',
          autoRestartListening: false,
        },
      };

      const engine = createVoiceEngine(config);

      await engine.startListening();
      await engine.stopListening();

      expect(engine.shouldAutoRestart()).toBe(false);
    });

    it('should not indicate auto-restart in push-to-talk mode', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
          mode: 'push-to-talk',
          autoRestartListening: true,
        },
      };

      const engine = createVoiceEngine(config);

      await engine.startListening();
      await engine.stopListening();

      expect(engine.shouldAutoRestart()).toBe(false);
    });
  });

  describe('sendAudioChunk', () => {
    it('should send audio when listening', async () => {
      const audioChunks: AudioChunk[] = [];

      // Override sendAudio to capture chunks
      const originalSendAudio = mockSTT.sendAudio.bind(mockSTT);
      mockSTT.sendAudio = (chunk: AudioChunk) => {
        audioChunks.push(chunk);
        originalSendAudio(chunk);
      };

      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      await engine.startListening();

      const chunk: AudioChunk = {
        data: new Uint8Array([1, 2, 3]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: Date.now(),
      };

      engine.sendAudioChunk(chunk);

      expect(audioChunks).toHaveLength(1);
      expect(audioChunks[0].data).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('should not send audio when not listening', async () => {
      const audioChunks: AudioChunk[] = [];

      // Override sendAudio to capture chunks
      const originalSendAudio = mockSTT.sendAudio.bind(mockSTT);
      mockSTT.sendAudio = (chunk: AudioChunk) => {
        audioChunks.push(chunk);
        originalSendAudio(chunk);
      };

      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      // Don't start listening

      const chunk: AudioChunk = {
        data: new Uint8Array([1, 2, 3]),
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: Date.now(),
      };

      engine.sendAudioChunk(chunk);

      expect(audioChunks).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('should cleanup resources', async () => {
      const config: VoiceEngineConfig = {
        provider: mockLLM,
        voice: {
          stt: mockSTT,
          tts: mockTTS,
        },
      };

      const engine = createVoiceEngine(config);

      await engine.startListening();
      expect(mockSTT.isConnected()).toBe(true);

      engine.destroy();

      // Providers should be disconnected
      expect(mockSTT.isConnected()).toBe(false);
      expect(mockTTS.isConnected()).toBe(false);
    });
  });
});
