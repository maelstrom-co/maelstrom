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
 * Raised for generic engine-input validation failures (e.g. a misconfigured
 * user-prompt customizer that throws inside `buildUserPrompt`). LLM-output
 * layout problems no longer surface here — they heal into
 * `EngineDiagnostics.droppedLayoutEntries` instead. System-prompt customizer
 * misconfiguration does not surface here either; it throws synchronously at
 * `createEngine` time.
 *
 * `field` optionally identifies the offending input path.
 */
export interface ValidationError {
  readonly _tag: 'ValidationError';
  readonly message: string;
  readonly field?: string;
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
 * Raised when the configured `HistoryStore` fails while recording a turn or
 * persisting an assistant_message. Distinct from {@link ProviderError}: that
 * one is the LLM adapter; history persistence is a separate subsystem, and
 * callers typically route the two failure modes to different recovery
 * strategies (LLM retry / fallback vs. store reconnection / degraded mode).
 *
 * `operation` names which engine entry point the failure originated in, so
 * callers can branch without string-matching `message`.
 */
export interface HistoryError {
  readonly _tag: 'HistoryError';
  readonly message: string;
  readonly operation: 'record_turn' | 'add_assistant_message' | 'clear';
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
 * `layer` distinguishes envelope-level failures (`sessionId` / `id` /
 * `timestamp` / `type` discriminator) from inner-payload failures
 * (`request.*` body for chart_request, `content` for assistant_message).
 * Derived from the first issue's path during construction.
 *
 * `field` is a dot-separated path string for human-readable logs only —
 * numeric array indices are stringified (`request.instances.0.vesselId` is
 * indistinguishable from a key named `'0'`). Programmatic consumers
 * (alerting, grouping, UI navigation) should read `issues[0].path` instead,
 * which preserves indices as numbers.
 *
 * `issues` carries the structured ZodIssue list for programmatic inspection.
 */
export interface RequestValidationError {
  readonly _tag: 'RequestValidationError';
  readonly message: string;
  readonly layer: 'envelope' | 'payload';
  readonly field: string;
  readonly issues: readonly z.ZodIssue[];
  readonly stack?: string;
}

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

export const parseError = (message: string, raw: string): ParseError => ({
  _tag: 'ParseError',
  message,
  raw,
  stack: captureStack(message),
});

export const providerError = (
  message: string,
  cause: unknown,
): ProviderError => ({
  _tag: 'ProviderError',
  message,
  cause,
  stack: captureStack(message),
});

export const validationError = (
  message: string,
  field?: string,
): ValidationError => ({
  _tag: 'ValidationError',
  message,
  field,
  stack: captureStack(message),
});

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

export const cancellationError = (
  message: string,
  reason: unknown,
): CancellationError => ({
  _tag: 'CancellationError',
  message,
  reason,
  stack: captureStack(message),
});

export const historyError = (
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

const formatField = (path: readonly PropertyKey[]): string =>
  path.length > 0 ? path.map(String).join('.') : '(root)';

const buildError = (
  layer: 'envelope' | 'payload',
  path: readonly PropertyKey[],
  issues: readonly z.ZodIssue[],
): RequestValidationError => {
  const field = formatField(path);
  const message = `request validation failed at ${layer}.${field}`;
  return {
    _tag: 'RequestValidationError',
    message,
    layer,
    field,
    issues,
    stack: captureStack(message),
  };
};

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
  // the layer.
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
