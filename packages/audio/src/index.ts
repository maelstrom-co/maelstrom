// @maelstrom/audio - Types only (shared between server and client)
//
// For server-side providers, use: import { ... } from '@maelstrom/audio/server'
// For client-side utilities, use: import { ... } from '@maelstrom/audio/client'

export type {
  SpeechGenerationOptions,
  SpeechGenerationProvider,
  SpeechGenerationResult,
  // STT Types
  STTConfig,
  STTEvent,
  STTProvider,
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionSegment,
  // TTS Types
  TTSConfig,
  TTSEvent,
  TTSProvider,
  VoiceInfo,
} from './lib/types.js';
