/** Discriminated union for fallible operations */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/** Extract the value from a Result, or throw the error. Non-Error values are wrapped in an Error with the original as `cause`. Use sparingly at system boundaries. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  if (result.error instanceof Error) throw result.error;
  throw new Error(
    typeof result.error === 'object' &&
      result.error !== null &&
      'message' in result.error
      ? String((result.error as { message: unknown }).message)
      : `unwrap() called on Err result: ${JSON.stringify(result.error)}`,
    { cause: result.error },
  );
}
