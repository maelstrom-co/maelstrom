export interface ParseError {
  readonly _tag: 'ParseError';
  readonly message: string;
  readonly raw: string;
  readonly stack?: string;
}

export interface ProviderError {
  readonly _tag: 'ProviderError';
  readonly message: string;
  readonly cause: unknown;
  readonly stack?: string;
}

export interface ValidationError {
  readonly _tag: 'ValidationError';
  readonly message: string;
  readonly field?: string;
  readonly stack?: string;
}

export interface TimeoutError {
  readonly _tag: 'TimeoutError';
  readonly message: string;
  readonly timeoutMs: number;
  readonly stack?: string;
}

export type EngineError =
  | ParseError
  | ProviderError
  | ValidationError
  | TimeoutError;

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
