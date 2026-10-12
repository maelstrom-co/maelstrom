export function identity(value: unknown): string | undefined {
  const candidate =
    typeof value === 'string' && value.length > 0 ? value : undefined;
  if (!candidate) return undefined;
  const bracket = candidate.lastIndexOf('[');
  const tail = bracket < 0 ? undefined : candidate.slice(bracket);
  return /\[(?:REDACTED|TRUNCATED|CIRCULAR|MAX_DEPTH)[^\]]*\]/.test(
    candidate,
  ) ||
    (tail &&
      ['[REDACTED]', '[TRUNCATED]', '[CIRCULAR]', '[MAX_DEPTH]'].some(
        (marker) => marker.startsWith(tail),
      ))
    ? undefined
    : candidate;
}
