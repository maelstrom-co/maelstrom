/**
 * Coerce an unknown thrown value into an `Error` instance.
 *
 * `try { ... } catch (e) { ... }` typically yields `e: unknown`. Most error-
 * handling sites need an `Error` instance to attach as `cause`, log a
 * stack, or propagate through APIs that require `Error`. This helper
 * preserves the original `Error` if one was thrown, and otherwise wraps
 * the stringified value in a new `Error` so the call site never has to
 * branch.
 *
 * @example
 * ```typescript
 * try {
 *   await risky();
 * } catch (err) {
 *   logger.error('risky failed', toError(err));
 * }
 * ```
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
