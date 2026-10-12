import type { DiagnosticEvent } from '@maelstrom-co/protocol';
import { identity } from './diagnostic-identity.js';

function requestKey(event: DiagnosticEvent): string | undefined {
  const clientId = identity(event.metadata.clientId);
  const requestId = identity(event.requestId);
  return clientId && requestId
    ? JSON.stringify([clientId, requestId])
    : undefined;
}

export function retainRequestEvents(
  previous: readonly DiagnosticEvent[],
  event: DiagnosticEvent,
  limit: number,
): { events: readonly DiagnosticEvent[]; dropped: number } {
  if (!requestKey(event)) return { events: previous, dropped: 0 };
  let events = [...previous, event];
  const keys = new Set(events.map(requestKey));
  while (events.length > limit && keys.size > 1) {
    const oldest = keys.values().next().value;
    events = events.filter((entry) => requestKey(entry) !== oldest);
    keys.delete(oldest);
  }
  // One oversized request remains inspectable as explicitly partial evidence.
  events = events.slice(-limit);
  return { events, dropped: previous.length + 1 - events.length };
}
