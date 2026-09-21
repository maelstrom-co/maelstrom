// Engine

// Config
export type { EngineConfig } from './lib/config.js';
export { resolveConfig } from './lib/config.js';
export type { Engine } from './lib/engine.js';
export { createEngine } from './lib/engine.js';
// Envelope handler — shared WS-host dispatch entry point
export { handleEnvelope, recoverCorrelation } from './lib/envelope-handler.js';

// Error types + constructors
export type {
  CancellationError,
  EngineError,
  HistoryError,
  ParseError,
  ProviderError,
  RequestValidationError,
  TimeoutError,
  ValidationError,
} from './lib/errors.js';
export {
  cancellationError,
  historyError,
  parseError,
  providerError,
  requestValidationError,
  timeoutError,
  validationError,
} from './lib/errors.js';
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
// Logger
export type { Logger } from './lib/logger.js';
export { consoleLogger } from './lib/logger.js';
// Planner stages
export type {
  LlmPlannerInput,
  LlmPlannerOptions,
} from './lib/planner/llm-planner.js';
export { llmPlanner } from './lib/planner/llm-planner.js';
export { pipeline } from './lib/planner/pipeline.js';
export type {
  Deferred,
  Planner,
  PlannerCandidate,
  PlanningInput,
  Retryable,
  RetryFeedback,
  Stage,
  StageContext,
  StageError,
  ValidateCandidate,
  ValidatedCandidate,
} from './lib/planner/stage.js';
export { deferred, isDeferred } from './lib/planner/stage.js';
export { withFallback } from './lib/planner/with-fallback.js';
export type { WithRetryOptions } from './lib/planner/with-retry.js';
export { withRetry } from './lib/planner/with-retry.js';
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
// Response diagnostics
export type { EngineDiagnostics } from './lib/response/response-processor.js';
export type {
  RetryHint,
  RetrySeverity,
} from './lib/validation/llm-output/healed-layout.js';
