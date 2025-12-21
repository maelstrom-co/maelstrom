// @maelstrom/audio/server - Server-side audio providers
//
// These providers require API keys and should only be used in server environments.
// They integrate with various cloud STT/TTS services.

// Re-export types for convenience
export type {
  TranscriptionResult,
  TranscriptionSegment,
  TranscribeOptions,
  TranscriptionProvider,
  SpeechGenerationOptions,
  SpeechGenerationResult,
  SpeechGenerationProvider,
} from './lib/types.js';

// AI SDK Providers
export {
  createAISDKTranscription,
  type AISDKTranscriptionOptions,
} from './lib/stt/ai-sdk-stt.js';

export {
  createAISDKSpeech,
  type AISDKSpeechOptions,
} from './lib/tts/ai-sdk-tts.js';

// Custom Providers
export {
  createCartesiaTTS,
  type CartesiaTTSOptions,
} from './lib/tts/cartesia-tts.js';
