/**
 * Narrows a possibly-undefined test capture to defined, throwing loudly if
 * it wasn't assigned by the time an assertion reads it.
 *
 * Test harnesses often capture render/hook output into an outer `let` that
 * TS can't prove is assigned by the time later assertions run (the
 * assignment happens inside a callback passed to `act`/`render`, or is
 * reset between renders by a mock). This replaces `value!.prop` — which
 * lies to the type system without checking anything at runtime — with an
 * explicit check that fails the test with a clear message instead of a
 * bare "Cannot read properties of undefined".
 */
export function assertDefined<T>(
  value: T,
  message = 'expected value to be defined',
): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}
