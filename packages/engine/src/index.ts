// Engine

// Config
export type {
  AdapterEngineConfig,
  EngineConfig,
  ExplicitPlannerConfig,
  FallbackPlannerRoute,
  FallbackTrigger,
  FinalizationPolicy,
  PlannerEngineConfig,
  PlannerRoute,
  ResolvedAdapterEngineConfig,
  ResolvedEngineConfig,
  ResolvedPlannerEngineConfig,
} from './lib/config.js';
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
  InvalidProviderResponseError,
  ParseError,
  PlanningBudgetExceededError,
  PlanningDeferredError,
  ProviderError,
  RequestValidationError,
  TimeoutError,
  ValidationError,
} from './lib/errors.js';
export {
  cancellationError,
  historyError,
  invalidProviderResponseError,
  parseError,
  planningBudgetExceededError,
  planningDeferredError,
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
// Planning
export type {
  FinalizationIssue,
  FinalizationIssueLocation,
  FinalizationReport,
  NormalizedActionEnumEntry,
  Planner,
  PlannerActionCandidate,
  PlannerCandidate,
  PlannerFailure,
  PlannerInvocation,
  PlannerProposal,
  PlanningCallBudget,
  PlanningDeferralReason,
  PlanningHistoryEntry,
  PlanningInput,
  PlanningOperationContext,
} from './lib/planning/contracts.js';
export type { LlmPlannerOptions } from './lib/planning/llm-planner.js';
export { createLlmPlanner } from './lib/planning/llm-planner.js';
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
