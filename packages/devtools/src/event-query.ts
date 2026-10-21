import {
  type EventOutcome,
  eventIssue,
  eventOutcome,
  matchesCategory,
} from './event-outcome.js';
import type { PanelEvent } from './panel-model.js';
import { type VoiceIdentity, voiceIdentity } from './voice-identity.js';

export type EventFamily = 'voice' | 'engine' | 'actions' | 'client' | 'other';
export type { EventOutcome } from './event-outcome.js';

export interface EventQuery {
  clientId?: string;
  query?: string;
  issueCategory?: string;
  family?: EventFamily;
  kind?: string;
  outcome?: EventOutcome;
  requestKey?: string;
  voiceKey?: string;
  from?: number;
  until?: number;
}

function eventFamily(event: PanelEvent): EventFamily {
  if (event.kind.startsWith('client.action.')) return 'actions';
  if (event.kind.startsWith('voice.')) return 'voice';
  if (event.kind.startsWith('engine.')) return 'engine';
  return event.kind.startsWith('client.') ? 'client' : 'other';
}

function eventRequestKey(event: PanelEvent): string | undefined {
  return event.clientId && event.requestId
    ? JSON.stringify([event.clientId, event.requestId])
    : undefined;
}

export function eventFilterChoices(events: readonly PanelEvent[]) {
  const requests = new Map<
    string,
    { key: string; clientId: string; requestId: string }
  >();
  const voices = new Map<
    string,
    VoiceIdentity & {
      clientId: string;
      providerInstanceId: string;
      generation: number;
    }
  >();
  for (const event of events) {
    const key = eventRequestKey(event);
    if (key && event.clientId && event.requestId) {
      requests.set(key, {
        key,
        clientId: event.clientId,
        requestId: event.requestId,
      });
    }
    const voice = voiceIdentity(event);
    if (
      voice?.clientId &&
      voice.providerInstanceId &&
      voice.generation !== undefined &&
      (voice.scope === 'session' || voice.scope === 'provider')
    )
      voices.set(voice.key, {
        ...voice,
        clientId: voice.clientId,
        providerInstanceId: voice.providerInstanceId,
        generation: voice.generation,
      });
  }
  return {
    kinds: [...new Set(events.map((event) => event.kind))].sort(),
    requests: [...requests.values()],
    voices: [...voices.values()],
  };
}

export function queryEvents(
  events: readonly PanelEvent[],
  query: EventQuery = {},
) {
  const invalidTimeRange =
    [query.from, query.until].some(
      (bound) =>
        bound !== undefined &&
        (!Number.isFinite(bound) || bound < 0 || bound > 8.64e15),
    ) ||
    (query.from !== undefined &&
      query.until !== undefined &&
      query.from > query.until);
  const matches = invalidTimeRange
    ? []
    : events.filter(
        (event) =>
          (!query.clientId || event.clientId === query.clientId) &&
          (!query.kind || event.kind === query.kind) &&
          (!query.requestKey || eventRequestKey(event) === query.requestKey) &&
          (!query.voiceKey || voiceIdentity(event)?.key === query.voiceKey) &&
          ((query.from === undefined && query.until === undefined) ||
            (event.at !== undefined && event.at <= 8.64e15)) &&
          (!query.query ||
            `${event.kind} ${event.requestId ?? ''} ${JSON.stringify(event.metadata)}`
              .toLowerCase()
              .includes(query.query.toLowerCase())) &&
          (query.from === undefined ||
            (event.at !== undefined && event.at >= query.from)) &&
          (query.until === undefined ||
            (event.at !== undefined && event.at <= query.until)) &&
          (!query.family || eventFamily(event) === query.family) &&
          matchesCategory(eventIssue(event), query.issueCategory) &&
          (!query.outcome || eventOutcome(event) === query.outcome),
      );
  return {
    events: matches,
    total: events.length,
    matched: matches.length,
    hidden: events.length - matches.length,
    invalidTimeRange,
  };
}
