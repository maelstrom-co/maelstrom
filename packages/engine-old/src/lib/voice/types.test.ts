/**
 * Tests for voice types and interfaces
 */

import { describe, expect, it } from 'bun:test';

import type {
  AudioChunk,
  AudioFormatConfig,
  SpeechChunk,
  SpeechOptions,
  STTProvider,
  TranscriptionResult,
  TTSProvider,
  VADConfig,
  VoiceConfig,
  VoiceEngineCallbacks,
  VoiceMode,
  VoiceSessionState,
} from './types.js';

describe('Voice Types', () => {
  describe('VoiceSessionState', () => {
    it('should accept all valid states', () => {
      const states: VoiceSessionState[] = [
        'idle',
        'listening',
        'processing',
        'speaking',
      ];
      expect(states).toHaveLength(4);
    });
  });

  describe('VoiceMode', () => {
    it('should accept all valid modes', () => {
      const modes: VoiceMode[] = ['push-to-talk', 'continuous', 'auto'];
      expect(modes).toHaveLength(3);
    });
  });

  describe('VADConfig', () => {
    it('should create valid VAD config with defaults', () => {
      const config: VADConfig = {};
      expect(config).toBeDefined();
    });

    it('should create valid VAD config with custom values', () => {
      const config: VADConfig = {
        utteranceEndMs: 3000,
        enabled: true,
        minSpeechDurationMs: 500,
      };
      expect(config.utteranceEndMs).toBe(3000);
      expect(config.enabled).toBe(true);
      expect(config.minSpeechDurationMs).toBe(500);
    });
  });

  describe('AudioFormatConfig', () => {
    it('should create valid audio format config', () => {
      const config: AudioFormatConfig = {
        inputSampleRate: 16000,
        outputSampleRate: 24000,
        inputEncoding: 'linear16',
        outputEncoding: 'pcm_f32le',
        bufferSize: 4096,
      };
      expect(config.inputSampleRate).toBe(16000);
      expect(config.outputSampleRate).toBe(24000);
    });

    it('should accept opus encoding', () => {
      const config: AudioFormatConfig = {
        inputEncoding: 'opus',
        outputEncoding: 'opus',
      };
      expect(config.inputEncoding).toBe('opus');
    });
  });

  describe('VoiceConfig', () => {
    it('should require stt and tts providers', () => {
      // Mock providers
      const mockSTT: STTProvider = {
        name: 'mock-stt',
        connect: async () => {},
        disconnect: async () => {},
        sendAudio: () => {},
        endStream: () => {},
        onEvent: () => () => {},
        isConnected: () => false,
        isListening: () => false,
      };

      const mockTTS: TTSProvider = {
        name: 'mock-tts',
        connect: async () => {},
        disconnect: async () => {},
        speak: () => {},
        stop: () => {},
        onEvent: () => () => {},
        isConnected: () => false,
        isSpeaking: () => false,
      };

      const config: VoiceConfig = {
        stt: mockSTT,
        tts: mockTTS,
      };

      expect(config.stt).toBe(mockSTT);
      expect(config.tts).toBe(mockTTS);
    });

    it('should accept full configuration', () => {
      const mockSTT: STTProvider = {
        name: 'mock-stt',
        connect: async () => {},
        disconnect: async () => {},
        sendAudio: () => {},
        endStream: () => {},
        onEvent: () => () => {},
        isConnected: () => false,
        isListening: () => false,
      };

      const mockTTS: TTSProvider = {
        name: 'mock-tts',
        connect: async () => {},
        disconnect: async () => {},
        speak: () => {},
        stop: () => {},
        onEvent: () => () => {},
        isConnected: () => false,
        isSpeaking: () => false,
      };

      const config: VoiceConfig = {
        stt: mockSTT,
        tts: mockTTS,
        mode: 'continuous',
        language: 'en',
        interimResults: true,
        vad: {
          utteranceEndMs: 2500,
          enabled: true,
        },
        audio: {
          inputSampleRate: 16000,
          outputSampleRate: 24000,
        },
        maxListeningDurationMs: 30000,
        autoRestartListening: true,
      };

      expect(config.mode).toBe('continuous');
      expect(config.language).toBe('en');
      expect(config.vad?.utteranceEndMs).toBe(2500);
    });
  });

  describe('AudioChunk', () => {
    it('should create valid audio chunk', () => {
      const audioData = new Uint8Array([1, 2, 3, 4, 5]);
      const chunk: AudioChunk = {
        data: audioData,
        sampleRate: 16000,
        encoding: 'linear16',
        timestamp: Date.now(),
        sequence: 0,
      };

      expect(chunk.data).toBe(audioData);
      expect(chunk.sampleRate).toBe(16000);
      expect(chunk.encoding).toBe('linear16');
    });
  });

  describe('TranscriptionResult', () => {
    it('should create valid transcription result', () => {
      const result: TranscriptionResult = {
        text: 'Hello world',
        isFinal: true,
        confidence: 0.95,
        language: 'en',
        durationInSeconds: 1.5,
      };

      expect(result.text).toBe('Hello world');
      expect(result.isFinal).toBe(true);
      expect(result.confidence).toBe(0.95);
    });

    it('should create interim transcription result', () => {
      const result: TranscriptionResult = {
        text: 'Hello',
        isFinal: false,
      };

      expect(result.isFinal).toBe(false);
    });
  });

  describe('SpeechChunk', () => {
    it('should create valid speech chunk', () => {
      const audioData = new Uint8Array([1, 2, 3, 4, 5]);
      const chunk: SpeechChunk = {
        data: audioData,
        format: 'pcm_f32le',
        sampleRate: 24000,
        text: 'Hello',
        isFinal: false,
        sequence: 0,
      };

      expect(chunk.data).toBe(audioData);
      expect(chunk.format).toBe('pcm_f32le');
      expect(chunk.text).toBe('Hello');
    });

    it('should create final speech chunk', () => {
      const chunk: SpeechChunk = {
        data: new Uint8Array(0),
        format: 'pcm_f32le',
        sampleRate: 24000,
        isFinal: true,
        sequence: 10,
      };

      expect(chunk.isFinal).toBe(true);
    });
  });

  describe('SpeechOptions', () => {
    it('should create valid speech options', () => {
      const options: SpeechOptions = {
        voice: 'default',
        speed: 1.2,
        language: 'en',
        sampleRate: 24000,
      };

      expect(options.voice).toBe('default');
      expect(options.speed).toBe(1.2);
    });
  });

  describe('VoiceEngineCallbacks', () => {
    it('should accept all callback types', () => {
      const callbacks: VoiceEngineCallbacks = {
        onVoiceStateChange: (state) => {
          console.log('State changed:', state);
        },
        onTranscript: (result) => {
          console.log('Transcript:', result.text);
        },
        onVADEvent: (event) => {
          console.log('VAD:', event.type);
        },
        onAudioOutput: (chunk) => {
          console.log('Audio chunk:', chunk.sequence);
        },
        onSpeechStarted: (text) => {
          console.log('Speech started:', text);
        },
        onSpeechStopped: (completed) => {
          console.log('Speech stopped:', completed);
        },
        onError: (error) => {
          console.error('Error:', error);
        },
      };

      expect(callbacks.onVoiceStateChange).toBeDefined();
      expect(callbacks.onTranscript).toBeDefined();
      expect(callbacks.onVADEvent).toBeDefined();
      expect(callbacks.onAudioOutput).toBeDefined();
    });
  });
});
