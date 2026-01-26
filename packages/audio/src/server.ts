// @maelstrom/audio/server - Server-side audio providers
//
// These providers require API keys and should only be used in server environments.
// They integrate with various cloud STT/TTS services.

// AI SDK Providers
export {
  type AISDKTranscriptionOptions,
  createAISDKTranscription,
} from './lib/stt/ai-sdk-stt.js';
export {
  type AISDKSpeechOptions,
  createAISDKSpeech,
} from './lib/tts/ai-sdk-tts.js';
// Custom Providers
export {
  type CartesiaTTSOptions,
  createCartesiaTTS,
} from './lib/tts/cartesia-tts.js';
// Re-export types for convenience
export type {
  SpeechGenerationOptions,
  SpeechGenerationProvider,
  SpeechGenerationResult,
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionSegment,
} from './lib/types.js';
