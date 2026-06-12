/**
 * Exhaustiveness helper for `switch` on a discriminated union. Fails at
 * compile time if `value` isn't narrowed to `never`; throws at runtime
 * with `context` as the diagnostic label if it ever gets reached (which
 * means the union grew a new variant without a matching `case`).
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
