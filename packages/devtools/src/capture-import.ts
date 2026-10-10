const ENVELOPE_ALLOWANCE = 262144;
const FORMATTING_EXPANSION = 66;

function compactLimit(maxCharacters: number): number {
  // Events have a serialized budget; metadata strings can expand sixfold when escaped.
  return maxCharacters * 7 + ENVELOPE_ALLOWANCE;
}

export function captureImportFileBytes(maxCharacters: number): number {
  return (
    compactLimit(maxCharacters) * 3 +
    (maxCharacters + ENVELOPE_ALLOWANCE) * FORMATTING_EXPANSION
  );
}

export function assertCaptureImportSize(
  json: string,
  maxCharacters: number,
): void {
  const limit = compactLimit(maxCharacters);
  if (json.length > captureImportFileBytes(maxCharacters))
    throw new Error('Capture exceeds the configured import size.');
  if (json.length <= limit) return;
  let characters = 0;
  let quoted = false;
  let escaped = false;
  for (const character of json) {
    if (quoted) {
      characters += character.length;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
      characters++;
    } else if (
      character !== ' ' &&
      character !== '\n' &&
      character !== '\r' &&
      character !== '\t'
    )
      characters += character.length;
    if (characters > limit)
      throw new Error('Capture exceeds the configured import size.');
  }
}

export function projectCaptureEvents(
  events: readonly Record<string, unknown>[],
  maxCharacters: number,
  project: (event: Record<string, unknown>) => Record<string, unknown> = (
    event,
  ) => event,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let characters = 0;
  for (const event of events) {
    const projected = project(event);
    characters += JSON.stringify(projected).length;
    if (characters > maxCharacters)
      throw new Error('Capture exceeds the configured import size.');
    result.push(projected);
  }
  return result;
}
