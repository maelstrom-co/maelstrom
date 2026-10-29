import {
  AppIdSchema,
  type DevtoolsAppId,
  type EventsPage,
  MAX_BRIDGE_BYTES,
  type ReadCommand,
  type ReadResult,
} from '@maelstrom-co/devtools-protocol';
import { identity } from './diagnostic-identity.js';
import { queryEvents } from './event-query.js';
import {
  liveEventOwner,
  liveEvidenceDisposed,
  liveEvidenceEpoch,
} from './live-evidence.js';
import { groupRequests, MAX_VIEW_EVENTS, panelEvents } from './panel-model.js';
import { requestEvidence } from './request-evidence.js';
import type { Devtools } from './types.js';

export function createDevtoolsReader(tools: Devtools) {
  let epoch = liveEvidenceEpoch(tools);
  const handles = new Map<string, DevtoolsAppId>();
  const pages = new Map<
    string,
    { signature: string; expires: number; data: EventsPage }
  >();
  const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  function page(
    id: string,
    offset: number,
    data: EventsPage,
    limit: number,
  ): ReadResult {
    const events: EventsPage['events'] = [];
    const result = (count = events.length, pageEvents = events) => ({
      ok: true as const,
      data: {
        ...data,
        events: pageEvents,
        remaining: data.events.length - offset - count,
        cursor:
          offset + count < data.events.length
            ? `${id}:${offset + count}`
            : undefined,
      },
    });
    let eventBytes = 0;
    for (const event of data.events.slice(offset, offset + limit)) {
      const size = bytes(event);
      const count = events.length + 1;
      // Cursor and remaining digit widths depend on the candidate event count.
      const envelopeBytes = bytes(result(count, []));
      if (
        envelopeBytes + eventBytes + size + count - 1 >
        MAX_BRIDGE_BYTES - 1024
      )
        break;
      events.push(event);
      eventBytes += size;
    }
    return !events.length && offset < data.events.length
      ? { ok: false, error: 'limit_exceeded' }
      : result();
  }
  function read(command: ReadCommand): ReadResult {
    if (liveEvidenceDisposed(tools))
      return { ok: false, error: 'target_unavailable' };
    if (epoch !== liveEvidenceEpoch(tools)) {
      pages.clear();
      epoch = liveEvidenceEpoch(tools);
    }
    const state = tools.getSnapshot();
    const currentIds = new Set(state.sessions.map((session) => session.id));
    for (const id of handles.keys())
      if (!currentIds.has(id)) handles.delete(id);
    const aliases = new Map<string, Set<string>>();
    const aliasOwners = new Map<string, Set<string>>();
    for (const value of new Set([
      ...state.activity.slice(-MAX_VIEW_EVENTS),
      ...state.requestActivity.slice(-MAX_VIEW_EVENTS),
      ...state.transportHistory.slice(-MAX_VIEW_EVENTS),
    ])) {
      const owner = liveEventOwner(tools, value);
      const alias = identity(value.metadata.clientId);
      if (!owner || !alias) continue;
      const names = aliases.get(owner) ?? new Set<string>();
      names.add(alias);
      aliases.set(owner, names);
      const sources = aliasOwners.get(alias) ?? new Set<string>();
      sources.add(owner);
      aliasOwners.set(alias, sources);
    }
    const apps = state.sessions.map((session) => {
      let id = handles.get(session.id);
      if (!id) {
        id = AppIdSchema.parse(crypto.randomUUID());
        handles.set(session.id, id);
      }
      const names = aliases.get(session.id);
      const alias = names?.values().next().value;
      const available =
        names?.size === 1 &&
        alias !== undefined &&
        aliasOwners.get(alias)?.size === 1;
      return {
        id,
        active: session.active,
        identity: available
          ? ('reported' as const)
          : names?.size
            ? ('ambiguous' as const)
            : ('unavailable' as const),
        reportedId: available ? alias : undefined,
        owner: session.id,
      };
    });
    if (command.operation === 'list_apps') {
      return {
        ok: true,
        data: {
          kind: 'apps',
          apps: apps.slice(0, 100).map(({ owner: _, ...app }) => app),
          omitted: Math.max(0, apps.length - 100),
        },
      };
    }
    const app = apps.find((item) => item.id === command.appId);
    if (!app) return { ok: false, error: 'app_unavailable' };
    if (app.identity !== 'reported')
      return { ok: false, error: 'evidence_unavailable' };
    for (const [id, item] of pages)
      if (item.expires <= Date.now()) pages.delete(id);
    const signature = JSON.stringify({ ...command, cursor: undefined });
    if (command.cursor !== undefined) {
      const match = /^([a-f0-9-]{36}):(\d{1,5})$/.exec(command.cursor);
      const saved = match ? pages.get(match[1]) : undefined;
      const offset = Number(match?.[2]);
      if (
        !match ||
        !saved ||
        saved.signature !== signature ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= saved.data.events.length
      )
        return { ok: false, error: 'stale_cursor' };
      return page(match[1], offset, saved.data, command.limit);
    }
    const view =
      command.operation === 'get_request' ? 'requests' : command.view;
    const values =
      view === 'requests'
        ? state.requestActivity
        : view === 'connections'
          ? state.transportHistory
          : state.activity;
    const events = panelEvents(values)
      .filter(
        (event) =>
          event.clientId === app.reportedId &&
          liveEventOwner(tools, event.raw) === app.owner,
      )
      .map((event) => ({ ...event, clientId: app.id }));
    const filtered = queryEvents(
      events,
      command.operation === 'get_request'
        ? { requestKey: JSON.stringify([command.appId, command.requestId]) }
        : command.criteria,
    );
    const request =
      command.operation === 'get_request'
        ? groupRequests(filtered.events)[0]
        : undefined;
    if (
      command.operation === 'get_request' &&
      (!identity(command.requestId) || !request)
    )
      return { ok: false, error: 'request_unavailable' };
    const data: EventsPage = {
      kind: 'events',
      view,
      observedAt: Date.now(),
      request: request
        ? { requestId: request.requestId, ...requestEvidence(request) }
        : undefined,
      events: filtered.events.map((event) => ({
        kind: event.kind,
        appId: command.appId,
        requestId: event.requestId,
        at: event.at,
        metadata: event.metadata,
      })),
      total: filtered.total,
      matched: filtered.matched,
      hidden: filtered.hidden,
      remaining: 0,
      viewerOmitted: Math.max(0, values.length - MAX_VIEW_EVENTS),
      losses: {
        scope: 'all_apps',
        recent: state.droppedActivityEvents,
        requests: state.droppedRequestEvents,
        connections: null,
      },
    };
    if (bytes(data) > 1_048_576) return { ok: false, error: 'limit_exceeded' };
    const frozen: EventsPage = JSON.parse(JSON.stringify(data));
    const id = crypto.randomUUID();
    const oldest = pages.keys().next().value;
    if (pages.size >= 2 && oldest) pages.delete(oldest);
    pages.set(id, { signature, expires: Date.now() + 30_000, data: frozen });
    return page(id, 0, frozen, command.limit);
  }
  return {
    read,
    dispose: () => {
      pages.clear();
      handles.clear();
    },
  };
}
