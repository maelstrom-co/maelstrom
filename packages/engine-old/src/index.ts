// Engine

// Providers
export {
  createOpenAIProvider,
  createTanStackProvider,
  type GeminiTextModel,
  type OpenAIChatModel,
} from './lib/ai-sdk-provider.js';
export type { Engine } from './lib/engine.js';
export { createEngine } from './lib/engine.js';
// History
export type {
  AIMessage,
  HistoryConfig,
  HistoryContentLevel,
  HistoryEntry,
  HistoryManager,
  HistoryStore,
  InMemoryHistoryStore,
  InMemoryStoreConfig,
} from './lib/history/index.js';
export {
  createHistoryManager,
  createInMemoryHistoryStore,
  DEFAULT_HISTORY_CONFIG,
} from './lib/history/index.js';
export { extractImportantPhrasesFromConversation } from './lib/phrase-extractor.js';
// Prompt utilities (for custom prompts)
export {
  buildPrompt,
  createPromptBuilder,
  getDefaultSystemPrompt,
  type PromptBuilder,
  type PromptBuilderResult,
  type PromptSections,
} from './lib/prompt-builder.js';
// Types
export type {
  AssistantProfile,
  EngineConfig,
  LLMProvider,
  LLMResponse,
  RetryConfig,
} from './lib/types.js';
export { EngineError } from './lib/types.js';
export type {
  CartesiaSpeechOptions,
  CartesiaTTSOptions,
} from './lib/voice/providers/cartesia-tts.js';
export { createCartesiaTTS } from './lib/voice/providers/cartesia-tts.js';
export type { DeepgramSTTOptions } from './lib/voice/providers/deepgram-stt.js';
// Voice Providers
export { createDeepgramSTT } from './lib/voice/providers/deepgram-stt.js';
// Voice
export type {
  AudioChunk,
  AudioFormatConfig,
  SpeechChunk,
  SpeechOptions,
  STTEvent,
  STTProvider,
  TranscriptionResult,
  TTSEvent,
  TTSProvider,
  VADConfig,
  VADEvent,
  VoiceConfig,
  VoiceEngine,
  VoiceEngineCallbacks,
  VoiceInput,
  VoiceMode,
  VoiceSessionState,
} from './lib/voice/types.js';
export type { VoiceEngineConfig } from './lib/voice/voice-engine.js';
export { createVoiceEngine, isVoiceEngine } from './lib/voice/voice-engine.js';
