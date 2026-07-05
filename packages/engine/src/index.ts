// Engine
export type { Engine } from './lib/engine.js';
export { createEngine } from './lib/engine.js';

// Envelope handler — shared WS-host dispatch entry point
export { handleEnvelope } from './lib/envelope-handler.js';

// Config
export type { EngineConfig } from './lib/config.js';
export { resolveConfig } from './lib/config.js';

// Error types + constructors
export type {
  CancellationError,
  EngineError,
  HistoryError,
  ParseError,
  ProviderError,
  RequestValidationError,
  ValidationError,
  TimeoutError,
} from './lib/errors.js';
export {
  cancellationError,
  historyError,
  parseError,
  providerError,
  requestValidationError,
  validationError,
  timeoutError,
} from './lib/errors.js';

// Logger
export type { Logger } from './lib/logger.js';
export { consoleLogger } from './lib/logger.js';

// Prompt sections — types and constants
export type {
  PromptSection,
  SectionCustomizer,
  SectionExtension,
  SystemSectionKey,
  SystemSectionOverrides,
  UserSectionKey,
  UserSectionOverrides,
} from './lib/prompt/sections.js';
export { SystemSection, UserSection } from './lib/prompt/sections.js';

// Prompt builder
export type {
  PromptOptions,
  PromptResult,
  PromptVars,
} from './lib/prompt/prompt-builder.js';
export {
  buildPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './lib/prompt/prompt-builder.js';

// History
export type {
  HistoryConfig,
  HistoryManager,
  LLMContextMessage,
} from './lib/history/history-manager.js';
export { createHistoryManager } from './lib/history/history-manager.js';
export type {
  HistoryEntry,
  HistoryStore,
} from './lib/history/history-store.js';
export { createInMemoryStore } from './lib/history/in-memory-store.js';
