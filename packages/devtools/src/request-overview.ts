import {
  groupRequests,
  identity,
  type PanelEvidence,
  type RequestTrace,
} from './panel-model.js';
import {
  type RequestOutcome,
  type RequestTimingEvidence,
  requestEvidence,
} from './request-evidence.js';

export type OverviewMeasure = 'round-trip' | 'application';
export type OverviewOutcome = RequestOutcome;
export interface OverviewFilters {
  clientId?: string;
  outcome?: OverviewOutcome | 'all';
  query?: string;
  measure?: OverviewMeasure;
  timing?: 'all' | 'reported' | 'unreported';
  page?: number;
}
export interface OverviewRow {
  request: RequestTrace;
  outcome: OverviewOutcome;
  timing: RequestTimingEvidence;
  at?: number;
  clock?: string;
  firstIndex: number;
}
export const overviewMeasures = {
  'round-trip': 'Request round-trip',
  application: 'Client application',
} as const;
export type OverviewWindow =
  | { kind: 'empty' }
  | {
      kind: 'client-time';
      clientId: string;
      from: number;
      to: number;
      missing: number;
    }
  | {
      kind: 'observed-order';
      from: number;
      to: number;
      missing: number;
      reason: 'multiple-clocks' | 'missing-time';
    };
function windowFor(rows: readonly OverviewRow[]): OverviewWindow {
  if (!rows.length) return { kind: 'empty' };
  const missing = rows.filter(
    (row) => row.at === undefined || !row.clock,
  ).length;
  const clocks = new Set(rows.flatMap((row) => (row.clock ? [row.clock] : [])));
  if (!missing && clocks.size === 1) {
    const times = rows.map((row) => row.at as number);
    return {
      kind: 'client-time',
      clientId: rows[0].request.clientId,
      from: Math.min(...times),
      to: Math.max(...times),
      missing,
    };
  }
  return {
    kind: 'observed-order',
    from: rows[0].firstIndex,
    to: rows.at(-1)?.firstIndex ?? 0,
    missing,
    reason: clocks.size > 1 ? 'multiple-clocks' : 'missing-time',
  };
}
export const OVERVIEW_PAGE_SIZE = 50;
export function requestOverview(
  evidence: PanelEvidence,
  filters: OverviewFilters = {},
) {
  const retained = groupRequests(evidence.requestEvents ?? evidence.events)
    .map((request): OverviewRow => {
      const facts = requestEvidence(request);
      const client = request.events.find((event) =>
        event.kind.startsWith('client.'),
      );
      const at =
        client?.at !== undefined && client.at <= 8_640_000_000_000_000
          ? client.at
          : undefined;
      const session = client && identity(client.raw.sessionId);
      return {
        request,
        outcome: facts.outcome,
        timing:
          filters.measure === 'application'
            ? facts.application
            : facts.roundTrip,
        firstIndex: request.events[0].index,
        at,
        clock:
          facts.outcome !== 'ambiguous' && session
            ? JSON.stringify([request.clientId, session])
            : undefined,
      };
    })
    .sort((a, b) => a.firstIndex - b.firstIndex);
  const query = filters.query?.trim().toLowerCase();
  const matched = retained.filter(
    (row) =>
      (!filters.clientId ||
        filters.clientId === 'all' ||
        row.request.clientId === filters.clientId) &&
      (!filters.outcome ||
        filters.outcome === 'all' ||
        row.outcome === filters.outcome) &&
      (!filters.timing ||
        filters.timing === 'all' ||
        (row.timing.kind === 'reported') === (filters.timing === 'reported')) &&
      (!query ||
        `${row.request.requestId} ${row.request.intent ?? ''}`
          .toLowerCase()
          .includes(query)),
  );
  const pages = Math.ceil(matched.length / OVERVIEW_PAGE_SIZE);
  const page = Math.max(
    0,
    Math.min(Math.floor(filters.page ?? 0), Math.max(0, pages - 1)),
  );
  return {
    rows: matched.slice(
      page * OVERVIEW_PAGE_SIZE,
      (page + 1) * OVERVIEW_PAGE_SIZE,
    ),
    retained: retained.length,
    matched: matched.length,
    hidden: retained.length - matched.length,
    missingTimings: matched.filter((row) => row.timing.kind === 'unreported')
      .length,
    page,
    pages,
    unassigned: evidence.events.filter(
      (event) =>
        (!event.requestId || !event.clientId) &&
        (event.raw.requestId !== undefined ||
          event.kind.startsWith('client.request.') ||
          event.kind.startsWith('client.response.')),
    ).length,
    window: windowFor(retained),
    plotWindow: windowFor(
      matched.slice(page * OVERVIEW_PAGE_SIZE, (page + 1) * OVERVIEW_PAGE_SIZE),
    ),
    loss: {
      dropped: evidence.requestEvents
        ? evidence.droppedRequestEvents
        : evidence.dropped,
      omitted: evidence.requestEvents
        ? evidence.omittedRequestEvents
        : evidence.omitted,
      unreadable: evidence.requestEvents
        ? evidence.unreadableRequestEvents
        : evidence.unreadableEvents,
    },
  };
}
