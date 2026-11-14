import { isSessionAgentEvent } from './agent-runs.js';
import { identity, identityAvailability } from './diagnostic-identity.js';
import type { PanelEvent, PanelEvidence, RequestTrace } from './panel-model.js';

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

/**
 * True when the retained source evidence cannot support a complete comparison
 * of the given requests. Dropped, omitted or unreadable events count, as does
 * any source event that could belong to a compared request but is unassigned.
 */
export function isComparisonSourceIncomplete(
  evidence: PanelEvidence,
  requests: readonly (RequestTrace | undefined)[],
): boolean {
  const comparedKinds = new Set(
    requests.flatMap((request) =>
      (request?.events ?? []).map((event) => event.kind),
    ),
  );
  return Boolean(
    evidence.unreadableEvents ||
    evidence.droppedRequestEvents ||
    evidence.dropped ||
    evidence.omittedRequestEvents ||
    evidence.omitted ||
    [...evidence.events, ...(evidence.requestEvents ?? [])].some((event) =>
      isIncompleteSourceEvent(event, comparedKinds),
    ),
  );
}

/**
 * True when a source event could belong to a request comparison but lacks a
 * usable requestId or clientId, so the comparison cannot be treated as
 * complete. Run-owned diagnostics, which report a runId and no requestId, are
 * exempt because they never belong to a request, as are session-level Agent
 * Session diagnostics that report no requestId. An event that reports a
 * requestId, even a redacted one, is neither and stays unassigned.
 */
export function isIncompleteSourceEvent(
  event: PanelEvent,
  comparedKinds: ReadonlySet<string>,
): boolean {
  if (event.requestId && event.clientId) return false;
  if (isRunOwned(event) || isSessionAgentEvent(event.kind, event.raw))
    return false;
  return (
    comparedKinds.has(event.kind) ||
    event.raw.requestId !== undefined ||
    /^(?:client\.(?:request|response|command|action)|engine)\./.test(event.kind)
  );
}

function isRunOwned(event: PanelEvent): boolean {
  return (
    identityAvailability(event.raw.requestId) === 'not-reported' &&
    identityAvailability(event.raw.runId) !== 'not-reported'
  );
}
