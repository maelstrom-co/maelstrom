import { sanitizeControlChars } from '@maelstrom-co/protocol';

export interface NormalizedActionParameterEnumValue {
  /** Sanitized JSON literal displayed verbatim in the Engine prompt. */
  readonly serialized: string;
  /** Detached, recursively frozen JSON value used for runtime comparison. */
  readonly value: unknown;
}

/** Returns the JSON value exactly as it is exposed in the Engine prompt. */
export function normalizeActionParameterEnumValue(
  value: unknown,
): NormalizedActionParameterEnumValue | undefined {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (json === undefined) return undefined;

  const serialized = sanitizeControlChars(json);
  return { serialized, value: JSON.parse(serialized) };
}
