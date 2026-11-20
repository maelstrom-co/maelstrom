/**
 * Lists the fields of `input` that are missing from `parsed`, as dotted paths
 * with array indices (for example `variants.list.actions.0.effect`).
 *
 * A schema that strips unknown keys drops the fields it does not recognise, so
 * a non-empty result means the schema that produced `parsed` does not know
 * those fields. Fields the parse adds, such as defaults, are ignored.
 */
export function findFieldsDroppedByParse(
  input: unknown,
  parsed: unknown,
): string[] {
  return collectDroppedFields(input, parsed, []);
}

function collectDroppedFields(
  input: unknown,
  parsed: unknown,
  path: readonly string[],
): string[] {
  if (!isObject(input)) return [];
  return Object.keys(input).flatMap((key) => {
    const fieldPath = [...path, key];
    if (!isObject(parsed) || !Object.hasOwn(parsed, key)) {
      return [fieldPath.join('.')];
    }
    return collectDroppedFields(input[key], parsed[key], fieldPath);
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
