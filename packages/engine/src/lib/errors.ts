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

export type EngineError =
  | ParseError
  | ProviderError
  | ValidationError
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
