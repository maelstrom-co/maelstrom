// Engine

// Providers
export { createAISDKProvider } from './lib/ai-sdk-provider.js';
export type { AssistantMessage, Engine } from './lib/engine.js';
export { createEngine } from './lib/engine.js';
// History
export type {
  AIMessage,
  AssistantMessageInput,
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
// Prompt utilities (for custom prompts)
export { buildPrompt, DEFAULT_SYSTEM_PROMPT } from './lib/prompt-builder.js';
// Types
export type { EngineConfig, LLMProvider, RetryConfig } from './lib/types.js';
export { EngineError } from './lib/types.js';
