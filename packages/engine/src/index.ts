// Engine
export type { Engine } from './lib/engine.js';
export { createEngine } from './lib/engine.js';

// Config
export type { EngineConfig } from './lib/config.js';
export { resolveConfig } from './lib/config.js';

// Error types + constructors
export type {
  CancellationError,
  EngineError,
  LayoutValidationError,
  LayoutValidationFailure,
  ParseError,
  ProviderError,
  ValidationError,
  TimeoutError,
} from './lib/errors.js';
export {
  cancellationError,
  layoutValidationError,
  parseError,
  providerError,
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
export { buildPrompt, buildSystemPrompt } from './lib/prompt/prompt-builder.js';

// History — configuration + store extensibility
export type { HistoryConfig } from './lib/history/history-manager.js';
export type { HistoryEntry, HistoryStore } from './lib/history/history-store.js';
export { createInMemoryStore } from './lib/history/in-memory-store.js';
