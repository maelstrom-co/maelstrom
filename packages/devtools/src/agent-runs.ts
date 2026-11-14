import { identity, identityAvailability } from './diagnostic-identity.js';
import type { PanelEvent } from './panel-model.js';

/**
 * Lifecycle status of one Agent Run. `queued` and `running` come from the
 * events seen so far, the others are the `reason` of `engine.agent.run.finished`.
 */
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'budget'
  | 'error'
  | 'cancelled';

/** Counters reported by `engine.agent.run.finished`. */
export interface AgentRunMetrics {
  /** Model turns the run took. */
  turns?: number;
  /** Tool calls the run made. */
  toolCalls?: number;
  /** Elapsed run time in milliseconds. */
  elapsedMs?: number;
  /** Provider input tokens reported for the run. */
  inputTokens?: number;
  /** Provider output tokens reported for the run. */
  outputTokens?: number;
  /** Provider calls that reported no token usage. */
  unreportedUsageCalls?: number;
}

/** Events of one Agent Run that share a `metadata.turnId`. */
export interface AgentRunTurn {
  /** Turn identifier from event metadata. */
  turnId: string;
  /** One-based turn position, when an event reported it. */
  turnIndex?: number;
  /** Events of the turn in arrival order. */
  events: PanelEvent[];
}

/** Evidence of one Agent Run, keyed by the receiving client and the run. */
export interface AgentRunTrace {
  /** `JSON.stringify([clientId, runId])`. */
  key: string;
  /** Client that received the run's events. */
  clientId: string;
  /** Agent Run identifier. */
  runId: string;
  /** Input that started the run. */
  inputId?: string;
  /** Input disposition, `agent` or `ui_only`. */
  disposition?: string;
  /** Status derived from the run's events. */
  status: AgentRunStatus;
  /** `outcome` of `engine.agent.run.finished`. */
  outcome?: string;
  /** Error code of a run that ended with an error. */
  code?: string;
  /** Budget limit of a run that ended on its budget. */
  limit?: string;
  /** Run duration in milliseconds, falling back to the reported elapsed time. */
  durationMs?: number;
  /** Counters from `engine.agent.run.finished`. */
  metrics?: AgentRunMetrics;
  /** True when the first retained run event is not `engine.agent.input.accepted`. */
  missingStart: boolean;
  /** Run events plus linked client and session events, in arrival order. */
  events: PanelEvent[];
  /** Events grouped by `metadata.turnId`, in first-seen order. */
  turns: AgentRunTurn[];
  /** Index of the newest event in the group. */
  lastIndex: number;
}

/** Agent events of one client that belong to no request and no run. */
export interface AgentSessionTimeline {
  /** Client that received the events. */
  clientId: string;
  /** Unlinked session-level agent events in arrival order. */
  events: PanelEvent[];
  /** Index of the newest event in the timeline. */
  lastIndex: number;
}

/** Agent Run groups and per-client session timelines of an event list. */
export interface AgentRunsModel {
  /** Run groups, newest activity first. */
  runs: AgentRunTrace[];
  /** Session timelines in order of each client's first unlinked event. */
  sessionTimelines: AgentSessionTimeline[];
}

/** The event fields that decide which Agent Run an event belongs to. */
export interface AgentRunLinkSubject {
  /** Diagnostic kind. */
  kind: string;
  /** Receiving client, when reported. */
  clientId?: string;
  /** Run owner, when reported. */
  runId?: string;
  /** Raw request owner, which may be redacted. */
  requestId?: unknown;
  /** Structural event metadata. */
  metadata: Readonly<Record<string, unknown>>;
}

/** The run an event belongs to, either by ownership or by lookup. */
export interface AgentRunLink {
  /** `JSON.stringify([clientId, runId])`. */
  key: string;
  /** Client that received the run's events. */
  clientId: string;
  /** Agent Run identifier. */
  runId: string;
}

/** Resolves events to the Agent Run they belong to. */
export interface AgentRunLinks {
  /**
   * Returns the run a run-owned event belongs to, or the run a client event or
   * rejected acknowledgement links to by `[clientId, inputId]` or
   * `[clientId, changeId]`. Returns undefined for anything else.
   */
  runOf(event: AgentRunLinkSubject): AgentRunLink | undefined;
}

/**
 * Builds the run lookup over a whole event list. Run-owned
 * `engine.agent.input.accepted` events index `[clientId, inputId]` and
 * run-owned `engine.agent.ui_change.emitted` events index
 * `[clientId, changeId]`. A later entry replaces an earlier one, so a reused
 * id links to the newest run.
 */
export function agentRunLinks(
  events: Iterable<AgentRunLinkSubject>,
): AgentRunLinks {
  const inputs = new Map<string, AgentRunLink>();
  const changes = new Map<string, AgentRunLink>();
  for (const event of events) {
    const run = ownRun(event);
    if (!run) continue;
    if (event.kind === 'engine.agent.input.accepted') {
      const inputId = identity(event.metadata.inputId);
      if (inputId) inputs.set(linkKey(run.clientId, inputId), run);
    } else if (event.kind === 'engine.agent.ui_change.emitted') {
      const changeId = identity(event.metadata.changeId);
      if (changeId) changes.set(linkKey(run.clientId, changeId), run);
    }
  }
  return {
    runOf(event) {
      const own = ownRun(event);
      if (own) return own;
      if (!event.clientId || !isSessionAgentEvent(event.kind, event)) return;
      const lookup = linkedLookup(event.kind);
      if (!lookup) return;
      const id = identity(event.metadata[lookup.idKey]);
      if (!id) return;
      return (lookup.idKey === 'inputId' ? inputs : changes).get(
        linkKey(event.clientId, id),
      );
    },
  };
}

/**
 * True for an agent diagnostic (`engine.agent.*` or `client.agent.*`) that
 * reports neither a requestId nor a runId, even a redacted one.
 */
export function isSessionAgentEvent(
  kind: string,
  owner: { requestId?: unknown; runId?: unknown },
): boolean {
  return (
    isAgentKind(kind) &&
    identityAvailability(owner.requestId) === 'not-reported' &&
    identityAvailability(owner.runId) === 'not-reported'
  );
}

/**
 * Groups Agent Run evidence by `[clientId, runId]` and collects agent events
 * that belong to no run into per-client session timelines. Events that report
 * a requestId never enter either.
 */
export function groupAgentRuns(events: readonly PanelEvent[]): AgentRunsModel {
  const links = agentRunLinks(events.map(linkSubject));
  const runs = new Map<string, AgentRunTrace>();
  const timelines = new Map<string, AgentSessionTimeline>();
  for (const event of events) {
    if (!event.clientId) continue;
    const subject = linkSubject(event);
    const link = links.runOf(subject);
    if (link) {
      const trace = runs.get(link.key) ?? newTrace(link, event.index);
      runs.set(link.key, trace);
      attach(trace, event, ownRun(subject) !== undefined);
    } else if (isSessionAgentEvent(event.kind, event.raw)) {
      const timeline = timelines.get(event.clientId) ?? {
        clientId: event.clientId,
        events: [],
        lastIndex: event.index,
      };
      timelines.set(event.clientId, timeline);
      timeline.events.push(event);
      timeline.lastIndex = event.index;
    }
  }
  return {
    runs: [...runs.values()].sort((a, b) => b.lastIndex - a.lastIndex),
    sessionTimelines: [...timelines.values()],
  };
}

function isAgentKind(kind: string): boolean {
  return kind.startsWith('engine.agent.') || kind.startsWith('client.agent.');
}

function ownRun(event: AgentRunLinkSubject): AgentRunLink | undefined {
  if (!event.clientId || !event.runId) return;
  if (identityAvailability(event.requestId) !== 'not-reported') return;
  return {
    key: linkKey(event.clientId, event.runId),
    clientId: event.clientId,
    runId: event.runId,
  };
}

function linkKey(clientId: string, id: string): string {
  return JSON.stringify([clientId, id]);
}

function linkedLookup(
  kind: string,
): { idKey: 'inputId' | 'changeId' } | undefined {
  switch (kind) {
    case 'client.agent.input.sent':
      return { idKey: 'inputId' };
    case 'client.agent.ui.applied':
    case 'engine.agent.ui_applied.rejected':
      return { idKey: 'changeId' };
    default:
      return undefined;
  }
}

function linkSubject(event: PanelEvent): AgentRunLinkSubject {
  return {
    kind: event.kind,
    clientId: event.clientId,
    runId: event.runId,
    requestId: event.raw.requestId,
    metadata: event.metadata,
  };
}

function newTrace(link: AgentRunLink, index: number): AgentRunTrace {
  return {
    ...link,
    status: 'queued',
    missingStart: true,
    events: [],
    turns: [],
    lastIndex: index,
  };
}

function attach(trace: AgentRunTrace, event: PanelEvent, owned: boolean) {
  const firstOwned = owned && !trace.events.some((entry) => entry.runId);
  trace.events.push(event);
  trace.lastIndex = event.index;
  if (!owned) return;
  const metadata = event.metadata;
  if (firstOwned)
    trace.missingStart = event.kind !== 'engine.agent.input.accepted';
  trace.inputId ??= identity(metadata.inputId);
  if (
    event.kind === 'engine.agent.input.accepted' ||
    event.kind === 'engine.agent.run.started'
  )
    trace.disposition ??= identity(metadata.disposition);
  const turnId = identity(metadata.turnId);
  if (turnId) {
    let turn = trace.turns.find((entry) => entry.turnId === turnId);
    if (!turn) {
      turn = { turnId, events: [] };
      trace.turns.push(turn);
    }
    turn.events.push(event);
    turn.turnIndex ??= count(metadata.turnIndex);
  }
  if (event.kind === 'engine.agent.run.finished') {
    trace.status = finishedStatus(metadata.reason) ?? 'running';
    trace.outcome = identity(metadata.outcome);
    trace.code = identity(metadata.code);
    trace.limit = identity(metadata.limit);
    trace.durationMs = count(metadata.durationMs) ?? count(metadata.elapsedMs);
    trace.metrics = {
      turns: count(metadata.turns),
      toolCalls: count(metadata.toolCalls),
      elapsedMs: count(metadata.elapsedMs),
      inputTokens: count(metadata.inputTokens),
      outputTokens: count(metadata.outputTokens),
      unreportedUsageCalls: count(metadata.unreportedUsageCalls),
    };
  } else if (
    trace.status === 'queued' &&
    event.kind !== 'engine.agent.input.accepted'
  )
    trace.status = 'running';
}

function finishedStatus(reason: unknown): AgentRunStatus | undefined {
  switch (reason) {
    case 'completed':
    case 'budget':
    case 'error':
    case 'cancelled':
      return reason;
    default:
      return undefined;
  }
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
