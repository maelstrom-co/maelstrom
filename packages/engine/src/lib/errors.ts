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
 * prompt customizer that throws inside `buildPrompt`). For LLM-output layout
 * issues use {@link LayoutValidationError} instead — the two have unrelated
 * programmatic shapes.
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
 * Discriminated failure modes produced by the LLM-output layout validators.
 * Each variant carries structured detail sufficient to build a targeted
 * correction prompt without re-parsing the human-readable `message`.
 */
export type LayoutValidationFailure =
  | { readonly kind: 'missing_rationale' }
  | { readonly kind: 'duplicate_instance_id'; readonly instanceId: string }
  | {
      readonly kind: 'position_overflow';
      readonly instanceId: string;
      readonly row: number;
      readonly column: number;
      readonly width: number;
      readonly height: number;
      readonly chartColumns: number;
      readonly chartRows: number;
    }
  | {
      readonly kind: 'size_below_minimum';
      readonly instanceId: string;
      readonly width: number;
      readonly height: number;
      readonly minWidth: number;
      readonly minHeight: number;
    }
  | { readonly kind: 'unknown_instance'; readonly instanceId: string }
  | { readonly kind: 'unknown_vessel'; readonly instanceId: string; readonly vesselId: string }
  | {
      readonly kind: 'unknown_variant';
      readonly instanceId: string;
      readonly variant: string;
    }
  | { readonly kind: 'tree_missing_child'; readonly atTokenIndex: number }
  | { readonly kind: 'tree_extra_tokens'; readonly unconsumedCount: number }
  | { readonly kind: 'orphan_tree_reference'; readonly instanceId: string };

/**
 * Raised when the LLM's layout output fails cross-field or request-relative
 * validation (overflow, missing rationale, malformed tiling tree, etc.).
 * Distinct from {@link ValidationError}: that one covers engine-input
 * validation; this one covers LLM-output layout validation.
 *
 * Consumers pattern-match on `_tag` and then on each `failure.kind` inside
 * `failures`. **`failures` is the authoritative programmatic contract;
 * `message` is a derived human-readable summary whose format is not
 * API-stable.** `failures` is non-empty by construction.
 *
 * @example
 * ```ts
 * const result = await engine.process(request);
 * if (isErr(result) && result.error._tag === 'LayoutValidationError') {
 *   for (const failure of result.error.failures) {
 *     if (failure.kind === 'position_overflow') {
 *       // targeted handling / retry prompt construction
 *     }
 *   }
 * }
 * ```
 */
export interface LayoutValidationError {
  readonly _tag: 'LayoutValidationError';
  readonly message: string;
  readonly failures: readonly [
    LayoutValidationFailure,
    ...LayoutValidationFailure[],
  ];
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
  | LayoutValidationError
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

/**
 * Build a {@link LayoutValidationError} from a non-empty list of failures.
 * Throws `RangeError` if `failures` is empty — callers should return
 * `ok(undefined)` when no failures exist rather than constructing an empty
 * error. The stored `failures` is a defensive copy so later mutation of the
 * caller's source array does not mutate the error.
 */
export const layoutValidationError = (
  failures: readonly LayoutValidationFailure[],
): LayoutValidationError => {
  if (failures.length === 0) {
    throw new RangeError(
      'layoutValidationError: failures must be non-empty; return ok(undefined) when no failures exist',
    );
  }
  const copied = [...failures] as unknown as [
    LayoutValidationFailure,
    ...LayoutValidationFailure[],
  ];
  const message =
    copied.length === 1
      ? `Layout validation failed: ${describeFailure(copied[0])}`
      : `Layout validation failed with ${copied.length} issues: ${copied
          .map(describeFailure)
          .join('; ')}`;
  return {
    _tag: 'LayoutValidationError',
    message,
    failures: copied,
    stack: captureStack(message),
  };
};

function describeFailure(failure: LayoutValidationFailure): string {
  switch (failure.kind) {
    case 'missing_rationale':
      return 'rationale is empty';
    case 'duplicate_instance_id':
      return `duplicate instanceId "${failure.instanceId}"`;
    case 'position_overflow':
      return `"${failure.instanceId}" at (row=${failure.row},col=${failure.column}) size ${failure.width}x${failure.height} exceeds chart ${failure.chartColumns}x${failure.chartRows}`;
    case 'size_below_minimum':
      return `"${failure.instanceId}" size ${failure.width}x${failure.height} is below minSize ${failure.minWidth}x${failure.minHeight}`;
    case 'unknown_instance':
      return `unknown instanceId "${failure.instanceId}"`;
    case 'unknown_vessel':
      return `"${failure.instanceId}" references unknown vessel "${failure.vesselId}"`;
    case 'unknown_variant':
      return `"${failure.instanceId}" has unknown variant "${failure.variant}"`;
    case 'tree_missing_child':
      return `tree split at token index ${failure.atTokenIndex} is missing a child`;
    case 'tree_extra_tokens':
      return `tree has ${failure.unconsumedCount} unconsumed token(s) after parse`;
    case 'orphan_tree_reference':
      return `tree references unknown instance "${failure.instanceId}"`;
  }
}
