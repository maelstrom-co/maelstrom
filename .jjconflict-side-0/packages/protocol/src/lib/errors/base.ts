/**
 * Base class for all Maelstrom-emitted errors.
 *
 * Carries a string `code` for programmatic switching (subclasses may narrow
 * this to discriminated unions) and an optional
 * `cause` slot that preserves the original error when the failure was
 * triggered by a lower-level rejection. Use `instanceof MaelstromError` to
 * catch any Maelstrom-emitted failure in a single branch.
 */
export class MaelstromError extends Error {
  public readonly code: string;
  public override readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'MaelstromError';
    this.code = code;
    this.cause = cause;
  }
}
