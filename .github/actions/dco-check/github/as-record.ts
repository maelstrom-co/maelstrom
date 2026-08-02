// Permissive narrowing: returns undefined for non-objects, for callers that
// treat a malformed payload as absent data rather than an error.
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
