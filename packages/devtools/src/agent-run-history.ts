import type { DiagnosticEvent } from '@maelstrom-co/protocol';

import {
  type AgentRunLinkSubject,
  agentRunLinks,
  isSessionAgentEvent,
} from './agent-runs.js';
import { identity, identityAvailability } from './diagnostic-identity.js';

/**
 * Appends an agent diagnostic to retained run evidence and evicts whole runs,
 * oldest first, once the limit is exceeded. Events reporting an unreadable
 * runId or any requestId are not retained and are not counted as dropped.
 */
export function retainAgentEvents(
  previous: readonly DiagnosticEvent[],
  event: DiagnosticEvent,
  limit: number,
): { events: readonly DiagnosticEvent[]; dropped: number } {
  if (!isRetained(event)) return { events: previous, dropped: 0 };
  let events = [...previous, event];
  if (events.length > limit) {
    const links = agentRunLinks(events.map(linkSubject));
    const groups = new Map<DiagnosticEvent, string | DiagnosticEvent>(
      events.map((entry) => [
        entry,
        links.runOf(linkSubject(entry))?.key ?? entry,
      ]),
    );
    const keys = new Set(groups.values());
    while (events.length > limit && keys.size > 1) {
      const [oldest] = keys;
      events = events.filter((entry) => groups.get(entry) !== oldest);
      keys.delete(oldest);
    }
  }
  // One oversized run remains inspectable as explicitly partial evidence.
  events = events.slice(-limit);
  return { events, dropped: previous.length + 1 - events.length };
}

function isRetained(event: DiagnosticEvent): boolean {
  const subject = linkSubject(event);
  if (!subject.clientId) return false;
  return identity(event.runId)
    ? identityAvailability(event.requestId) === 'not-reported'
    : isSessionAgentEvent(event.kind, event);
}

function linkSubject(event: DiagnosticEvent): AgentRunLinkSubject {
  return {
    kind: event.kind,
    clientId: identity(event.metadata.clientId),
    runId: event.runId,
    requestId: event.requestId,
    metadata: event.metadata,
  };
}
