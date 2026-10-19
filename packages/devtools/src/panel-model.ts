import { computeTilingLayout, parseTilingTree } from '@maelstrom-co/client';
import {
  parseTilingSplitToken,
  type TilingNode,
  TilingNodeSchema,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';
import type { TelemetryErrorCategory } from '@maelstrom-co/telemetry';
import { projectDiagnosticMetadata } from '@maelstrom-co/telemetry/integration';
import { eventIdentity, identity } from './diagnostic-identity.js';
import type { LiveEventKeys } from './live-event-keys.js';

export { identity } from './diagnostic-identity.js';
export {
  type RequestCounterpart,
  requestCounterparts,
} from './request-counterparts.js';

export type Fields = Record<string, unknown>;
export const MAX_VIEW_EVENTS = 10000;

export function fields(value: unknown): Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Fields)
    : {};
}
export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
export function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
export function humanize(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function duration(value: unknown): string {
  const number = numeric(value);
  if (number === undefined) return 'Not reported';
  return number < 1000
    ? `${Math.round(number * 10) / 10} ms`
    : `${Math.round(number / 100) / 10} s`;
}

export interface PanelEvent {
  key: string;
  kind: string;
  at?: number;
  requestId?: string;
  clientId?: string;
  metadata: Fields;
  content: unknown;
  raw: Fields;
  index: number;
}

export const errorCategories: Readonly<
  Record<TelemetryErrorCategory, { label: string; explanation: string }>
> = {
  transport: {
    label: 'Transport',
    explanation: 'Communication with a service failed.',
  },
  validation: {
    label: 'Validation',
    explanation: 'Input or a response did not match the expected format.',
  },
  timeout: {
    label: 'Timeout',
    explanation: 'The operation exceeded its time limit.',
  },
  readiness: {
    label: 'Readiness',
    explanation: 'An Instance was not ready to run the Action.',
  },
  application: {
    label: 'Application',
    explanation: 'The client could not apply a response or run an Action.',
  },
  provider: { label: 'Provider', explanation: 'A provider operation failed.' },
  unknown: {
    label: 'Unknown',
    explanation: 'The producer could not classify the problem.',
  },
};
export interface EventIssue {
  eventKey: string;
  outcome: 'failed' | 'skipped' | 'unknown';
  category?: TelemetryErrorCategory;
}
export function eventIssue(event: PanelEvent): EventIssue | undefined {
  const fact = projectDiagnosticMetadata(event.kind, event.metadata);
  if (
    fact?.outcome === 'failed' ||
    fact?.outcome === 'skipped' ||
    fact?.outcome === 'unknown'
  )
    return {
      eventKey: event.key,
      outcome: fact.outcome,
      category: fact.errorCategory,
    };
  if (
    event.metadata.outcome !== 'cancelled' &&
    (event.kind === 'engine.planner.failed' ||
      event.kind === 'client.command.failed' ||
      event.kind === 'client.connection.failed' ||
      (event.kind === 'engine.candidate.validated' &&
        event.metadata.outcome === 'failed'))
  )
    return { eventKey: event.key, outcome: 'failed' };
  return undefined;
}

export function panelEvents(
  values: readonly unknown[],
  liveKeys?: LiveEventKeys,
): PanelEvent[] {
  const offset = Math.max(0, values.length - MAX_VIEW_EVENTS);
  const retained = values.slice(offset);
  const counts = new Map<string, number>();
  if (!liveKeys)
    for (const value of retained) {
      const id = eventIdentity(value);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  return retained.flatMap((value, position) => {
    const raw = fields(value);
    const kind = text(raw.kind);
    if (!kind) return [];
    const metadata = fields(raw.metadata);
    const index = offset + position;
    const id = eventIdentity(value);
    const key =
      liveKeys?.key(raw) ??
      JSON.stringify(
        id && counts.get(id) === 1
          ? ['event', id]
          : ['position', id ?? '', index],
      );
    return [
      {
        key,
        kind,
        at: numeric(raw.at),
        requestId: identity(raw.requestId),
        clientId: identity(metadata.clientId),
        metadata,
        content: raw.content,
        raw,
        index,
      },
    ];
  });
}

export type RequestStatus =
  | 'awaiting'
  | 'received'
  | 'applied'
  | 'applied-with-issues'
  | 'failed'
  | 'cancelled'
  | 'discarded'
  | 'abandoned';
export interface EngineTiming {
  eventKey: string;
  kind: 'request' | 'planning' | 'stage';
  label: string;
  durationMs?: number;
}
export interface RequestTrace {
  key: string;
  requestId: string;
  clientId: string;
  events: PanelEvent[];
  status: RequestStatus;
  push: boolean;
  missingStart: boolean;
  transportMs?: number;
  applicationMs?: number;
  commandMs?: number;
  engineTimings: EngineTiming[];
  issues: EventIssue[];
  succeededActions: number;
  observedFailedActions: number;
  observedSkippedActions: number;
  failedActions?: number;
  skippedActions?: number;
  intent?: string;
  lastIndex: number;
}

export interface RequestPhase {
  eventKey: string;
  lane: string;
  label: string;
  outcome: string;
  durationMs?: number;
}

export function requestEventCoverage(
  a: RequestTrace | undefined,
  b: RequestTrace | undefined,
) {
  const counts = new Map<string, { kind: string; a: number; b: number }>();
  for (const side of ['a', 'b'] as const)
    for (const event of (side === 'a' ? a : b)?.events ?? []) {
      const row = counts.get(event.kind) ?? { kind: event.kind, a: 0, b: 0 };
      row[side]++;
      counts.set(event.kind, row);
    }
  return [...counts.values()];
}

export function requestTimingComparison(
  a: RequestTrace | undefined,
  b: RequestTrace | undefined,
) {
  const measures = [
    [
      'Request round-trip',
      a?.push ? undefined : a?.transportMs,
      b?.push ? undefined : b?.transportMs,
    ],
    ['Client application', a?.applicationMs, b?.applicationMs],
  ] as const;
  return measures.map(([label, aMs, bMs]) => ({
    label,
    aMs,
    bMs,
    deltaMs: aMs === undefined || bMs === undefined ? undefined : bMs - aMs,
  }));
}

function diagnosticPhaseOutcome(event: PanelEvent): string {
  switch (event.kind) {
    case 'engine.candidate.validated':
      return event.metadata.outcome === 'failed' ||
        event.metadata.outcome === 'succeeded'
        ? humanize(event.metadata.outcome)
        : 'Not reported';
    case 'engine.planner.failed':
      return event.metadata.outcome === 'cancelled' ? 'Cancelled' : 'Failed';
    case 'client.command.completed':
      return 'Completed';
    case 'client.command.failed':
      return 'Failed';
    case 'client.response.abandoned':
      return 'Abandoned';
    default:
      return 'Not reported';
  }
}

export function requestPhases(request: RequestTrace): RequestPhase[] {
  return request.events.map((event) => {
    const fact = projectDiagnosticMetadata(event.kind, event.metadata);
    const lane =
      event.kind.startsWith('client.request.') ||
      event.kind === 'client.response.received'
        ? 'Client request'
        : event.kind.startsWith('client.response.')
          ? 'Client application'
          : event.kind.startsWith('client.command.')
            ? 'Command'
            : event.kind.startsWith('client.action.')
              ? 'Action'
              : event.kind.startsWith('engine.request.')
                ? 'Engine request'
                : event.kind.startsWith('engine.planner.')
                  ? 'Planning'
                  : event.kind.startsWith('engine.stage.')
                    ? 'Engine stage'
                    : 'Other evidence';
    const outcome =
      fact?.outcome === 'succeeded_with_issues'
        ? 'Applied with Action issues'
        : fact
          ? humanize(fact.outcome)
          : diagnosticPhaseOutcome(event);
    return {
      eventKey: event.key,
      lane,
      label: [
        eventLabel(event),
        text(event.metadata.stage),
        text(event.metadata.action),
      ]
        .filter(Boolean)
        .join(' · '),
      outcome,
      durationMs:
        event.kind === 'client.command.completed' ||
        event.kind === 'client.action.ready' ||
        event.kind === 'client.action.unavailable'
          ? numeric(event.metadata.durationMs)
          : fact?.durationMs,
    };
  });
}

const terminalStatuses: Readonly<Record<string, RequestStatus>> = {
  'client.response.applied': 'applied',
  'client.response.failed': 'failed',
  'client.request.failed': 'failed',
  'client.response.discarded': 'discarded',
  'client.response.abandoned': 'abandoned',
};

export function groupRequests(events: readonly PanelEvent[]): RequestTrace[] {
  const requests = new Map<string, RequestTrace>();
  for (const event of events) {
    if (!event.requestId || !event.clientId) continue;
    const key = JSON.stringify([event.clientId, event.requestId]);
    let trace = requests.get(key);
    if (!trace) {
      trace = {
        key,
        requestId: event.requestId,
        clientId: event.clientId,
        events: [],
        status: 'awaiting',
        push: false,
        missingStart: true,
        engineTimings: [],
        issues: [],
        succeededActions: 0,
        observedFailedActions: 0,
        observedSkippedActions: 0,
        lastIndex: event.index,
      };
      requests.set(key, trace);
    }
    trace.events.push(event);
    trace.lastIndex = event.index;
    const issue = eventIssue(event);
    if (issue) trace.issues.push(issue);
    const engineTiming: Pick<EngineTiming, 'kind' | 'label'> | undefined =
      event.kind === 'engine.request.completed'
        ? { kind: 'request', label: 'Engine request' }
        : event.kind === 'engine.planner.completed'
          ? { kind: 'planning', label: 'Planning' }
          : event.kind === 'engine.stage.completed' ||
              event.kind === 'engine.stage.failed'
            ? {
                kind: 'stage',
                label: `Stage: ${text(event.metadata.stage) ?? 'Not reported'}`,
              }
            : undefined;
    if (engineTiming)
      trace.engineTimings.push({
        eventKey: event.key,
        ...engineTiming,
        durationMs: numeric(event.metadata.durationMs),
      });
    if (event.kind === 'client.request.started') {
      trace.missingStart = false;
      const reasons = list(
        fields(fields(fields(event.content).request).context).updateReasons,
      );
      trace.intent =
        reasons
          .flatMap((value) => {
            const reason = fields(value);
            return reason.type === 'user_intent' && text(reason.intent)
              ? [String(reason.intent)]
              : [];
          })
          .join('\n') || undefined;
    }
    if (event.kind === 'client.response.received') {
      if (trace.status === 'awaiting') trace.status = 'received';
      if (event.metadata.source === 'push') {
        trace.push = true;
        trace.missingStart = false;
      } else trace.transportMs = numeric(event.metadata.durationMs);
    }
    if (event.kind === 'client.request.failed')
      trace.transportMs = numeric(event.metadata.durationMs);
    if (
      event.kind === 'client.response.applied' ||
      event.kind === 'client.response.failed'
    )
      trace.applicationMs = numeric(event.metadata.durationMs);
    if (event.kind === 'client.command.completed') {
      const elapsed = numeric(event.metadata.durationMs);
      if (elapsed !== undefined)
        trace.commandMs = (trace.commandMs ?? 0) + elapsed;
    }
    if (event.kind === 'client.action.completed') {
      if (event.metadata.outcome === 'succeeded') trace.succeededActions++;
      if (event.metadata.outcome === 'failed') trace.observedFailedActions++;
      if (event.metadata.outcome === 'skipped') trace.observedSkippedActions++;
    }
    const terminal = Object.hasOwn(terminalStatuses, event.kind)
      ? terminalStatuses[event.kind]
      : undefined;
    if (terminal) {
      trace.status =
        event.kind === 'client.request.failed' &&
        event.metadata.outcome === 'cancelled'
          ? 'cancelled'
          : terminal;
      if (terminal === 'applied') {
        trace.failedActions = numeric(event.metadata.actionFailures);
        trace.skippedActions = numeric(event.metadata.skippedActions);
        if ((trace.failedActions ?? 0) > 0 || (trace.skippedActions ?? 0) > 0)
          trace.status = 'applied-with-issues';
      }
    }
  }
  for (const request of requests.values())
    if (
      request.status === 'applied' &&
      (request.observedFailedActions > 0 || request.observedSkippedActions > 0)
    )
      request.status = 'applied-with-issues';
  return [...requests.values()].sort((a, b) => b.lastIndex - a.lastIndex);
}

export const statusLabels: Readonly<Record<RequestStatus, string>> = {
  awaiting: 'Awaiting outcome',
  received: 'Response received',
  applied: 'Applied',
  'applied-with-issues': 'Applied with Action issues',
  failed: 'Failed',
  cancelled: 'Cancelled',
  discarded: 'Discarded',
  abandoned: 'Abandoned',
};
const eventLabels: Readonly<Record<string, string>> = {
  'client.attached': 'App instance attached',
  'client.disposed': 'App instance disposed',
  'client.request.started': 'Request sent',
  'client.request.failed': 'Request failed',
  'client.response.received': 'Response received',
  'client.response.queued': 'Response queued',
  'client.response.applied': 'Response applied',
  'client.response.failed': 'Response application failed',
  'client.response.discarded': 'Response discarded',
  'client.response.abandoned': 'Response abandoned',
  'client.action.waiting': 'Waiting for Action readiness',
  'client.action.ready': 'Action ready',
  'client.action.unavailable': 'Action unavailable',
  'client.action.started': 'Action started',
  'client.action.completed': 'Action completed',
  'client.snapshot': 'App state captured',
  'client.connection.changed': 'Engine connection changed',
  'client.connection.attempt': 'Engine connection attempt',
  'client.connection.failed': 'Engine connection failed',
  'client.diagnostics.unavailable': 'Server diagnostics unavailable',
};
export function eventLabel(event: PanelEvent): string {
  if (
    event.kind === 'client.request.failed' &&
    event.metadata.outcome === 'cancelled'
  )
    return 'Request cancelled';
  if (event.kind.startsWith('client.command.')) {
    const command = text(event.metadata.command);
    return `${command === 'set_layout' ? 'Layout' : command === 'execute_actions' ? 'Actions' : humanize(command ?? 'Command')} ${event.kind.split('.').at(-1)}`;
  }
  return Object.hasOwn(eventLabels, event.kind)
    ? eventLabels[event.kind]
    : humanize(event.kind);
}

export interface PanelApp {
  id: string;
  sessionId?: string;
  active?: boolean;
  inspection: unknown;
}
export interface PanelEvidence {
  events: PanelEvent[];
  requestEvents?: PanelEvent[];
  droppedRequestEvents?: number;
  omittedRequestEvents?: number;
  apps: PanelApp[];
  dropped?: number;
  omitted: number;
  unreadableEvents?: number;
  note?: string;
  metadata: Fields;
}

export function countUnreadableEvents(values: readonly unknown[]): number {
  return values
    .slice(-MAX_VIEW_EVENTS)
    .reduce<number>(
      (count, value) =>
        count + Number(identity(fields(value).kind) === undefined),
      0,
    );
}

export function recordingEvidence(value: unknown): PanelEvidence {
  const root = fields(value);
  const capture = 'capture' in root ? fields(root.capture) : root;
  const values = list(capture.events);
  const events = panelEvents(values);
  const apps = new Map<string, PanelApp>();
  for (const event of events) {
    if (!event.clientId) continue;
    const app = apps.get(event.clientId) ?? {
      id: event.clientId,
      sessionId: text(event.raw.sessionId),
      inspection: {},
    };
    const body = fields(event.content);
    if (
      event.kind === 'client.connection.changed' &&
      text(event.metadata.status)
    ) {
      const previous = fields(app.inspection);
      app.inspection = {
        ...previous,
        snapshot: {
          ...fields(previous.snapshot ?? previous),
          connection: event.metadata.status,
        },
      };
    } else if (event.kind === 'client.chart.resized') {
      const previous = fields(app.inspection);
      app.inspection = {
        ...previous,
        snapshot: {
          ...fields(previous.snapshot ?? previous),
          chart: body,
        },
      };
    } else if (
      event.kind === 'client.snapshot' ||
      event.kind === 'client.attached'
    ) {
      if ('snapshot' in body) app.inspection = body;
    } else if (
      event.kind === 'client.response.applied' ||
      event.kind === 'client.command.completed'
    ) {
      if ('layout' in body || Array.isArray(body.instances)) {
        const previous = fields(app.inspection);
        const snapshot = { ...fields(previous.snapshot ?? previous), ...body };
        if (body.chartDimensions) snapshot.chart = body.chartDimensions;
        app.inspection = { ...previous, snapshot };
      }
    }
    apps.set(app.id, app);
  }
  return {
    events,
    apps: [...apps.values()],
    dropped: numeric(capture.droppedEvents),
    omitted: Math.max(0, values.length - MAX_VIEW_EVENTS),
    unreadableEvents: countUnreadableEvents(values),
    note: text(capture.outcome),
    metadata: fields(capture.metadata),
  };
}

export interface PreviewTile {
  instanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface InspectorInstance {
  instanceId: string;
  vesselId?: string;
  vesselName?: string;
  variant?: string;
  visible?: boolean;
  actions: Fields[];
  minSize: Fields;
  raw: Fields;
  definition: Fields;
}
export interface InspectorState {
  connection?: string;
  columns?: number;
  rows?: number;
  layout: Fields;
  instances: InspectorInstance[];
  vessels: Fields[];
  tiles: PreviewTile[] | null;
  raw: unknown;
}

function tilingTiles(tree: unknown): PreviewTile[] | null {
  if (!Array.isArray(tree) || tree.length > 2048) return null;
  if (tree.length === 0) return [];
  const nodes: TilingNode[] = [];
  const depths = [0];
  const ids = new Set<string>();
  for (const value of tree) {
    const depth = depths.pop();
    if (depth === undefined || depth > 64) return null;
    const parsed = TilingNodeSchema.safeParse(value);
    if (!parsed.success) return null;
    const token = parsed.data;
    nodes.push(token);
    const split = parseTilingSplitToken(token);
    if (split) {
      if (split.repairReason !== null) return null;
      for (const _weight of split.weights) depths.push(depth + 1);
    } else {
      const id = tilingLeafInstanceId(token);
      if (id !== null) {
        if (ids.has(id)) return null;
        ids.add(id);
      }
    }
  }
  if (depths.length > 0) return null;
  return computeTilingLayout(
    parseTilingTree(nodes),
    { x: 0, y: 0, width: 100, height: 100 },
    0,
  ).map((tile) => ({ instanceId: tile.instanceId, ...tile.rect }));
}

function gridTiles(
  layout: Fields,
  columns?: number,
  rows?: number,
): PreviewTile[] | null {
  if (
    !columns ||
    !rows ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    !Array.isArray(layout.positions) ||
    layout.positions.length > 1000
  )
    return null;
  const tiles: PreviewTile[] = [];
  const ids = new Set<string>();
  for (const value of layout.positions) {
    const item = fields(value),
      position = fields(item.position),
      size = fields(item.size);
    const id = text(item.instanceId),
      column = numeric(position.column),
      row = numeric(position.row),
      width = numeric(size.width),
      height = numeric(size.height);
    if (
      !id ||
      ids.has(id) ||
      column === undefined ||
      row === undefined ||
      !width ||
      !height ||
      ![column, row, width, height].every(Number.isInteger) ||
      column + width > columns ||
      row + height > rows
    )
      return null;
    ids.add(id);
    tiles.push({
      instanceId: id,
      x: (column / columns) * 100,
      y: (row / rows) * 100,
      width: (width / columns) * 100,
      height: (height / rows) * 100,
    });
  }
  return tiles;
}

export function inspectState(value: unknown): InspectorState {
  const outer = fields(value);
  const state = fields(outer.snapshot ?? outer);
  const structural = fields(state.instances);
  const layout = fields(state.layout ?? structural.layout);
  const chart = fields(
    state.chart ?? state.chartDimensions ?? structural.chartDimensions,
  );
  const columns = numeric(chart.columns),
    rows = numeric(chart.rows);
  const vessels = list(outer.vessels ?? state.vessels)
    .map(fields)
    .filter((vessel) => text(vessel.id));
  const definitions = new Map(
    vessels.map((vessel) => [String(vessel.id), vessel]),
  );
  const observed = list(
    Array.isArray(state.instances) ? state.instances : structural.instances,
  );
  const declarations = layout.type === 'tiling' ? list(layout.instances) : [];
  const olderInstances = new Map<string, Fields>();
  for (const value of [...declarations, ...observed]) {
    const instance = fields(value),
      id = identity(instance.instanceId);
    if (id) olderInstances.set(id, { ...olderInstances.get(id), ...instance });
  }
  const values =
    state.retainedInstances === undefined
      ? [...olderInstances.values()]
      : list(state.retainedInstances);
  const tiles =
    layout.type === 'tiling'
      ? tilingTiles(layout.tree)
      : layout.type === 'grid'
        ? gridTiles(layout, columns, rows)
        : null;
  const visible = new Set(tiles?.map((tile) => tile.instanceId));
  const instances = values.flatMap((value) => {
    const raw = fields(value),
      instanceId = identity(raw.instanceId);
    if (!instanceId) return [];
    const vesselId = text(raw.vesselId),
      variant = text(raw.variant);
    const definition = definitions.get(vesselId ?? '') ?? {};
    const variantDefinition = fields(
      fields(definition.variants)[variant ?? ''],
    );
    return [
      {
        instanceId,
        vesselId,
        variant,
        vesselName: text(definition.name),
        visible: tiles === null ? undefined : visible.has(instanceId),
        actions: list(variantDefinition.actions).map(fields),
        minSize: fields(variantDefinition.minSize),
        raw,
        definition,
      },
    ];
  });
  return {
    connection: text(state.connection),
    columns,
    rows,
    layout,
    instances,
    vessels,
    tiles,
    raw: value,
  };
}
