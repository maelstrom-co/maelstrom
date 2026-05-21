type ErrorLike = { readonly message: string; readonly cause?: unknown };

function asErrorLike(value: unknown): ErrorLike | null {
  if (value instanceof Error) {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  ) {
    return value as ErrorLike;
  }

  return null;
}

export function flattenErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<object>();

  while (true) {
    const errorLike = asErrorLike(current);
    if (errorLike === null) {
      break;
    }

    if (seen.has(errorLike)) {
      current = undefined;
      break;
    }

    seen.add(errorLike);
    parts.push(errorLike.message);
    current = errorLike.cause;
  }

  if (current !== undefined && current !== null) {
    parts.push(String(current));
  }

  return parts.join(': ');
}
