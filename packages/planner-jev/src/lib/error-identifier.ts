const ERROR_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Whether `value` is a short identifier, a string of 1 to 64 characters
 * from `[A-Za-z0-9_.:-]`. A provider's error type or code is kept only when
 * it is one, so free-form provider text never reaches a failure or a log.
 */
export function isErrorIdentifier(value: unknown): value is string {
  return typeof value === 'string' && ERROR_IDENTIFIER.test(value);
}
