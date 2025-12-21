// @maelstrom/audio - Types only (shared between server and client)
//
// For server-side providers, use: import { ... } from '@maelstrom/audio/server'
// For client-side utilities, use: import { ... } from '@maelstrom/audio/client'

export type {
  // STT Types
  STTConfig,
  STTEvent,
  STTProvider,
  TranscriptionResult,
  TranscriptionSegment,
  TranscribeOptions,
  TranscriptionProvider,
  // TTS Types
  TTSConfig,
  TTSEvent,
  TTSProvider,
  VoiceInfo,
  SpeechGenerationOptions,
  SpeechGenerationResult,
  SpeechGenerationProvider,
} from './lib/types.js';
