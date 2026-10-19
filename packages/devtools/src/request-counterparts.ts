import { identity } from './diagnostic-identity.js';
import type { PanelEvent, RequestTrace } from './panel-model.js';

export type RequestCounterpart =
  | 'unmatched'
  | 'unknown'
  | 'incomplete'
  | 'unavailable';

function operationKey(event: PanelEvent): string | undefined {
  const keys = event.kind.startsWith('engine.stage.')
    ? ['stage']
    : event.kind.startsWith('client.action.')
      ? ['action', 'instanceId']
      : event.kind.startsWith('client.command.')
        ? ['command']
        : [];
  const values = keys.map((key) => identity(event.metadata[key]));
  return values.some((value) => value === undefined)
    ? undefined
    : JSON.stringify([event.kind, ...values]);
}

export function requestCounterparts(
  request: RequestTrace,
  other: RequestTrace | undefined,
  sourceIncomplete = false,
): ReadonlyMap<string, RequestCounterpart> {
  const kinds = new Set<string>();
  const incompleteKinds = new Set<string>();
  const operations = new Set<string>();
  for (const event of other?.events ?? []) {
    kinds.add(event.kind);
    const key = operationKey(event);
    if (key === undefined) incompleteKinds.add(event.kind);
    else operations.add(key);
  }
  const partial =
    sourceIncomplete ||
    other?.missingStart ||
    other?.status === 'awaiting' ||
    other?.status === 'received';
  return new Map(
    request.events.map((event) => {
      const key = operationKey(event);
      const counterpart: RequestCounterpart = !other
        ? 'unavailable'
        : partial
          ? 'incomplete'
          : !kinds.has(event.kind)
            ? 'unmatched'
            : key === undefined ||
                incompleteKinds.has(event.kind) ||
                operations.has(key)
              ? 'unknown'
              : 'unmatched';
      return [event.key, counterpart];
    }),
  );
}
