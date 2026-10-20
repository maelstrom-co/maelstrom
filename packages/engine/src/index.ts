// Engine

// Action parameter enums
export type {
  ActionParameterEnumSnapshot,
  NormalizedActionParameterEnumValue,
} from './lib/action-parameter-enum.js';
export { buildActionParameterEnumSnapshot } from './lib/action-parameter-enum.js';
// Config
export type { EngineConfig } from './lib/config.js';
export { resolveConfig } from './lib/config.js';
export type {
  DiagnosticConnection,
  DiagnosticConnectionOptions,
  EngineDiagnosticObserver,
  EngineMetadataObserver,
} from './lib/diagnostics.js';
export { createDiagnosticConnection } from './lib/diagnostics.js';
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
export type {
  EngineDiagnostics,
  PipelineOutput,
  PlannerCandidate,
  PlannerOutput,
  ReplylessCandidate,
  ValidatedCandidate,
  ValidatedReplylessCandidate,
} from './lib/planner/candidate.js';
export { isNeedsClarification } from './lib/planner/candidate.js';
// Planner stages
export type {
  Instrument,
  InstrumentAttributes,
} from './lib/planner/instrument.js';
export {
  named,
  noopInstrument,
  stageName,
} from './lib/planner/instrument.js';
export { pipeline } from './lib/planner/pipeline.js';
export type {
  PlanValidationInput,
  PlanValidationIssue,
  PlanValidator,
} from './lib/planner/plan-validator.js';
export type {
  ClarifyingPlanner,
  Deferred,
  Planner,
  PlanningInput,
  Retryable,
  RetryFeedback,
  Stage,
  StageContext,
  StageError,
  ValidateCandidate,
} from './lib/planner/stage.js';
export { deferred, enumSnapshotFor, isDeferred } from './lib/planner/stage.js';
export { withFallback } from './lib/planner/with-fallback.js';
export type { WithRetryOptions } from './lib/planner/with-retry.js';
export { withRetry } from './lib/planner/with-retry.js';
// Execution plan replay
export type { SimulationError } from './lib/response/execution-plan/final-variants.js';
export {
  finalVariants,
  legalActions,
} from './lib/response/execution-plan/final-variants.js';
export {
  attachEngineTelemetry,
  type EngineTelemetrySource,
} from './lib/telemetry.js';
// Update reasons
export { isResizeOnlyBatch } from './lib/update-reasons.js';
// Validation
export { formatValidationIssues } from './lib/validation/format-validation-issues.js';
// Response diagnostics
export type {
  RetryHint,
  RetrySeverity,
} from './lib/validation/llm-output/healed-layout.js';
