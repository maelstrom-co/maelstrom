function getErrorCause(error: Error): unknown {
  if (!('cause' in error)) {
    return undefined;
  }

  return error.cause;
}

export function flattenErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<Error>();

  while (current instanceof Error) {
    if (seen.has(current)) {
      current = undefined;
      break;
    }

    seen.add(current);
    parts.push(current.message);
    current = getErrorCause(current);
  }

  if (current !== undefined && current !== null) {
    parts.push(String(current));
  }

  return parts.join(': ');
}
