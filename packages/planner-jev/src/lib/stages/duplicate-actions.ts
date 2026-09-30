/**
 * A key equal for two actions exactly when they share instance, action name
 * and parameter values, whatever order the parameters were written in at
 * any depth. Array items keep their order.
 */
export function actionKey(
  instanceId: string,
  action: string,
  params: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify([instanceId, action, sortedKeys(params)]);
}

/** Items split into the first of each key, in order, and every later repeat. */
export interface FirstOfEachKey<T> {
  readonly kept: readonly T[];
  readonly dropped: readonly T[];
}

/**
 * Keeps the first item of each key and drops the later ones. An item whose
 * key is `undefined` is always kept, for items that cannot be compared yet.
 */
export function keepFirstOfEachKey<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
): FirstOfEachKey<T> {
  const seen = new Set<string>();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined && seen.has(key)) dropped.push(item);
    else {
      if (key !== undefined) seen.add(key);
      kept.push(item);
    }
  }
  return { kept, dropped };
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]),
  );
}
