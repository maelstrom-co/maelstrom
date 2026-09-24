import type { EngineMessageBase } from '@maelstrom-co/protocol';
import type { z } from 'zod';

/**
 * Raised when the LLM's raw textual output cannot be parsed — typically a
 * missing required field or malformed JSON before schema validation runs.
 *
 * Callers pattern-match on `_tag`. `raw` preserves the original string so
 * downstream diagnostics can log or surface the unparseable payload.
 */
export interface ParseError {
  readonly _tag: 'ParseError';
  readonly message: string;
  readonly raw: string;
  readonly stack?: string;
}

/**
 * Raised when the underlying LLM provider (TanStack AI adapter) fails — e.g.
 * network error, rate limit, or provider-side fault. The original thrown
 * value is preserved in `cause` for provider-specific inspection.
 */
export interface ProviderError {
  readonly _tag: 'ProviderError';
  readonly message: string;
  readonly cause: unknown;
  readonly stack?: string;
}

/**
 * Raised for generic engine-input validation failures (e.g. a planner that
 * cannot build its prompt from the request). LLM-output layout problems do
 * not surface here — they heal into `EngineDiagnostics.droppedLayoutEntries`
 * instead. A planner's own construction-time misconfiguration does not
 * surface here either; `@maelstrom-co/planner-llm` throws synchronously
 * when `llmPlanner` is constructed.
 *
 * `field` optionally identifies the offending input path as a free-form
 * symbolic name (e.g. `'prompt'`, `'history'`, `'vessels'` for Action
 * parameter definitions the Engine cannot snapshot, or `'planner'` for a
 * planner that deferred with no fallback or threw) — not a structured Zod
 * path.
 * For wire-format validation failures with structured access paths, see
 * {@link RequestValidationError} and its `path` field.
 *
 * `cause` carries the underlying thrown value when this error wraps a caught
 * throw, so a consumer-supplied `Error` subclass (with its stack and
 * `Error.cause` chain) survives the boundary. Both `field` and `cause` are
 * absent — not `undefined` — when the engine synthesizes the failure itself
 * (e.g. a `history not configured` guard with no upstream throw to attribute).
 */
export interface ValidationError {
  readonly _tag: 'ValidationError';
  readonly message: string;
  readonly field?: string;
  readonly cause?: unknown;
  readonly stack?: string;
}

/**
 * Raised when an operation exceeds its configured deadline.
 * `timeoutMs` is always a non-negative finite number.
 */
export interface TimeoutError {
  readonly _tag: 'TimeoutError';
  readonly message: string;
  readonly timeoutMs: number;
  readonly stack?: string;
}

/**
 * Raised when an operation is cancelled via an `AbortSignal` (either
 * pre-aborted or aborted mid-flight). `reason` preserves the caller-supplied
 * abort reason (matches the Web `AbortSignal.reason` contract).
 */
export interface CancellationError {
  readonly _tag: 'CancellationError';
  readonly message: string;
  readonly reason: unknown;
  readonly stack?: string;
}

/**
 * Raised when the configured `HistoryStore` fails. Distinct from
 * {@link ProviderError}: that one is the LLM adapter; history persistence
 * is a separate subsystem, and callers typically route the two failure
 * modes to different recovery strategies (LLM retry / fallback vs. store
 * reconnection / degraded mode).
 *
 * `operation` discriminates the failing call site so callers can branch
 * without string-matching `message`. Today the engine emits three members
 * on its public Err channel: `add_assistant_message` from the
 * `assistant_message` entry point, `get_llm_context` from `chart_request`
 * history-context loading, and `get_history` from {@link Engine.getHistory}.
 * `record_turn` and `clear` are reserved tags — `recordTurn` failures in
 * the `chart_request` arm are advisory (logged but not returned); `clear`
 * is exposed on the public `HistoryManager` interface but not surfaced
 * through `Engine.handle`. `leader_pipeline` is a defensive catch-all kept
 * as a follower-hang guard inside the idempotency machinery in
 * {@link Engine.handle} — unreachable under normal operation (every
 * per-stage error path returns via the Result channel), but if some future
 * refactor lets a throw escape, followers awaiting the in-flight leader
 * observe this discriminant instead of hanging forever.
 */
export interface HistoryError {
  readonly _tag: 'HistoryError';
  readonly message: string;
  readonly operation:
    | 'record_turn'
    | 'add_assistant_message'
    | 'clear'
    | 'get_llm_context'
    | 'get_history'
    | 'leader_pipeline';
  readonly cause: unknown;
  readonly stack?: string;
}

/**
 * Raised when an EngineMessage fails wire-format validation at the entry to
 * `engine.handle`. Distinct from {@link ValidationError} (engine-internal
 * validation, e.g. prompt-build throws or history-not-configured guards):
 * a `RequestValidationError` always means the *caller* sent malformed
 * input and should fix it client-side.
 *
 * `layer` and `path` are both derived from the first envelope-touching issue,
 * falling back to the first issue overall. Cross-field invariant: when
 * `layer === 'envelope'`, `path` is either `[]` (root-level failure) or
 * `path[0]` is one of the envelope discriminator/header keys (`sessionId` |
 * `id` | `timestamp` | `type`). The type does not encode this — prefer the
 * {@link requestValidationError} constructor over hand-built object literals
 * to keep the invariant intact.
 *
 * `layer` distinguishes envelope-level failures (`sessionId` / `id` /
 * `timestamp` / `type` discriminator) from inner-payload failures
 * (`request.*` body for chart_request, `content` for assistant_message).
 *
 * `path` is the structured access path to the offending field, with array
 * indices preserved as numbers (e.g. `['request', 'instances', 2, 'vesselId']`
 * — index `2` is a `number`, not the string `'2'`). Use this for programmatic
 * consumers (alerting, grouping, UI navigation). For human-readable logs,
 * join with `'.'`; be aware that joining conflates a numeric-index segment
 * with a string key literally named `'0'`. An empty array means a root-level
 * failure — typically a non-object envelope, but also the defensive fallback
 * when an empty `issues` list is passed in. Symbol segments (only reachable
 * from programmatic callers passing `superRefine`-emitted issues) are coerced
 * via `Symbol.prototype.toString()`; wire-ingress paths never contain symbols.
 *
 * `message` is derived from `layer` and `path` at construction; do not
 * synthesize independently.
 *
 * `issues` carries the structured ZodIssue list for full diagnostic detail.
 */
export interface RequestValidationError {
  readonly _tag: 'RequestValidationError';
  readonly message: string;
  readonly layer: 'envelope' | 'payload';
  readonly path: readonly (string | number)[];
  readonly issues: readonly z.ZodIssue[];
  readonly stack?: string;
}

/** Closed union of failures returned by Engine operations. */
export type EngineError =
  | ParseError
  | ProviderError
  | ValidationError
  | RequestValidationError
  | TimeoutError
  | CancellationError
  | HistoryError;

const captureStack = (message: string): string | undefined =>
  new Error(message).stack;

/** Creates a parse failure while retaining the raw provider output. */
export const parseError = (message: string, raw: string): ParseError => ({
  _tag: 'ParseError',
  message,
  raw,
  stack: captureStack(message),
});

/** Creates a provider failure while retaining its original cause. */
export const providerError = (
  message: string,
  cause: unknown,
): ProviderError => ({
  _tag: 'ProviderError',
  message,
  cause,
  stack: captureStack(message),
});

/**
 * Creates a semantic validation failure.
 *
 * Omitted `field` and `cause` properties remain absent rather than being set
 * to `undefined`, so key-presence checks and serialization stay meaningful.
 */
export const validationError = (
  message: string,
  field?: string,
  cause?: unknown,
): ValidationError => ({
  _tag: 'ValidationError',
  message,
  // Conditional spread keeps optional keys absent (not `undefined`-valued)
  // when the caller omits them, matching the type's optionality and keeping
  // `'cause' in err` / `'field' in err` honest for consumers that branch on
  // key presence (logging, JSON serialization, shallow equality).
  ...(field !== undefined && { field }),
  ...(cause !== undefined && { cause }),
  stack: captureStack(message),
});

/**
 * Creates a timeout failure for a non-negative finite duration.
 *
 * @throws {RangeError} If `timeoutMs` is negative or non-finite.
 */
export const timeoutError = (
  message: string,
  timeoutMs: number,
): TimeoutError => {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(
      `timeoutError: timeoutMs must be non-negative finite, got ${timeoutMs}`,
    );
  }
  return {
    _tag: 'TimeoutError',
    message,
    timeoutMs,
    stack: captureStack(message),
  };
};

/** Creates a cancellation failure while retaining the caller-supplied reason. */
export const cancellationError = (
  message: string,
  reason: unknown,
): CancellationError => ({
  _tag: 'CancellationError',
  message,
  reason,
  stack: captureStack(message),
});

// Single source of truth for the HistoryError shape. Private so the
// `operation` literal can only be set via one of the per-operation
// constructors below — a typo there becomes a compile error rather than a
// silently-misattributed log line that no test catches.
const buildHistoryError = (
  message: string,
  operation: HistoryError['operation'],
  cause: unknown,
): HistoryError => ({
  _tag: 'HistoryError',
  message,
  operation,
  cause,
  stack: captureStack(message),
});

/**
 * Per-operation factories for {@link HistoryError}. Each constructor pins
 * its `operation` literal at the type level, so an in-package call site
 * can no longer tag (for example) a `record_turn` failure as
 * `add_assistant_message` by passing the wrong string.
 *
 * Prefer these over hand-constructing the discriminated union directly. The
 * type itself remains structurally exported for consumers' pattern-matching;
 * the constructor-only guarantee applies to in-package construction only.
 */
export const historyError = {
  recordTurn: (message: string, cause: unknown): HistoryError =>
    buildHistoryError(message, 'record_turn', cause),
  addAssistantMessage: (message: string, cause: unknown): HistoryError =>
    buildHistoryError(message, 'add_assistant_message', cause),
  clear: (message: string, cause: unknown): HistoryError =>
    buildHistoryError(message, 'clear', cause),
  getLLMContext: (message: string, cause: unknown): HistoryError =>
    buildHistoryError(message, 'get_llm_context', cause),
  getHistory: (message: string, cause: unknown): HistoryError =>
    buildHistoryError(message, 'get_history', cause),
  leaderPipeline: (message: string, cause: unknown): HistoryError =>
    buildHistoryError(message, 'leader_pipeline', cause),
} as const;

// Envelope field names, type-gated against `EngineMessageBase` (plus the
// `type` discriminator that lives on each `EngineMessage` variant) so a
// future envelope-shape change (adding `traceId`, etc.) forces this set to
// grow or the typecheck fails.
type EnvelopeField = keyof EngineMessageBase | 'type';
const ENVELOPE_FIELDS = new Set<EnvelopeField>([
  'sessionId',
  'id',
  'timestamp',
  'type',
]);

// Zod types `ZodIssue.path` as `PropertyKey[]` (`string | number | symbol`)
// to support `.superRefine` callbacks that emit symbol-keyed paths. Wire
// ingress (JSON.parse → Zod) cannot produce a symbol segment, but programmatic
// callers of `requestValidationError` could. Stringify defensively so the
// public `path` honors its `(string | number)[]` contract without a cast.
const normalizePath = (
  path: readonly PropertyKey[],
): readonly (string | number)[] =>
  path.map((segment) =>
    typeof segment === 'symbol' ? segment.toString() : segment,
  );

const formatPathForMessage = (path: readonly (string | number)[]): string =>
  path.length > 0 ? path.join('.') : '(root)';

const buildError = (
  layer: 'envelope' | 'payload',
  rawPath: readonly PropertyKey[],
  issues: readonly z.ZodIssue[],
): RequestValidationError => {
  const path = normalizePath(rawPath);
  const message = `request validation failed at ${layer}.${formatPathForMessage(path)}`;
  return {
    _tag: 'RequestValidationError',
    message,
    layer,
    path,
    issues,
    stack: captureStack(message),
  };
};

/**
 * Classifies Zod request issues as envelope or payload validation failures.
 *
 * Root issues and empty issue lists are envelope failures. Otherwise, any
 * issue on an envelope field wins regardless of issue order; remaining issues
 * are payload failures. Symbol path segments are stringified in the result.
 */
export const requestValidationError = (
  issues: readonly z.ZodIssue[],
): RequestValidationError => {
  // Empty-path inputs (`null`, `42`, `'chart_request'`) are structural
  // envelope failures — the envelope itself is missing or wrong-shaped.
  // The empty-issues case (Zod never produces it; defensive-only) lands
  // here too so the `(root)` sentinel always carries `layer: 'envelope'`.
  const rootFailure = issues.find((i) => i.path.length === 0);
  if (rootFailure !== undefined || issues.length === 0) {
    return buildError('envelope', rootFailure?.path ?? [], issues);
  }

  // Scan all issues for an envelope-field path rather than reading only
  // `issues[0]` — Zod's issue ordering is not a documented stable contract,
  // and a future schema change (e.g. a `.superRefine` on the inner payload)
  // could surface a payload issue before the envelope one and silently flip
  // the layer. The `String()` coercion handles the same defensive symbol case
  // as `normalizePath`: a `Symbol('sessionId')` first segment stringifies to
  // `'Symbol(sessionId)'`, misses `ENVELOPE_FIELDS`, and correctly falls
  // through to payload classification.
  const envelopeIssue = issues.find(
    (i) =>
      i.path.length > 0 &&
      ENVELOPE_FIELDS.has(String(i.path[0]) as EnvelopeField),
  );
  if (envelopeIssue !== undefined) {
    return buildError('envelope', envelopeIssue.path, issues);
  }

  // All remaining issues live inside the inner payload (request body /
  // assistant_message content). Surface the first issue's path.
  const fallback = issues[0];
  return buildError('payload', fallback?.path ?? [], issues);
};
