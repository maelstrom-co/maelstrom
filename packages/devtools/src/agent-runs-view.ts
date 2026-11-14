import {
  type AgentRunStatus,
  type AgentRunTrace,
  type AgentSessionTimeline,
  duration,
  eventLabel,
  groupAgentRuns,
  humanize,
  type PanelEvent,
  text,
} from './panel-model.js';
import {
  badge,
  button,
  element,
  empty,
  factList,
  type RenderedView,
  type ViewContext,
} from './panel-views.js';

export interface AgentRunsViewState {
  runKey?: string;
  eventKey?: string;
  sourceToken?: string;
}

export function agentRunsView(
  context: ViewContext,
  state: AgentRunsViewState,
  change: (next: AgentRunsViewState) => void,
): RenderedView {
  const model = groupAgentRuns(
    context.evidence.runEvents ?? context.evidence.events,
  );
  const inScope = (clientId: string) =>
    context.clientId === 'all' || clientId === context.clientId;
  const runs = model.runs.filter((run) => inScope(run.clientId));
  const timelines = model.sessionTimelines.filter((timeline) =>
    inScope(timeline.clientId),
  );
  const selected = state.runKey
    ? runs.find((run) => run.key === state.runKey)
    : runs[0];
  const navigation = element('div');
  const visibleRuns = runs.slice(0, context.pageSize);
  if (selected && !visibleRuns.includes(selected)) visibleRuns.push(selected);
  for (const run of visibleRuns)
    navigation.append(
      runRow(context, run, run === selected, () =>
        change({ ...state, runKey: run.key, eventKey: undefined }),
      ),
    );
  if (runs.length > visibleRuns.length)
    navigation.append(
      moreButton(
        `Show more agent runs (${visibleRuns.length} of ${runs.length})`,
        'agent-more-runs',
        context.more,
      ),
    );
  const content = element('section', undefined, 'agent-runs');
  const selectEvent = (event: PanelEvent, runKey?: string) =>
    change({ ...state, runKey: runKey ?? state.runKey, eventKey: event.key });
  if (selected)
    content.append(runDetail(context, selected, state.eventKey, selectEvent));
  else
    content.append(
      empty(
        state.runKey
          ? 'The selected agent run is no longer retained.'
          : 'No agent runs match this selection. Agent runs appear when an app sends input to an Agent Session.',
      ),
    );
  content.append(
    sessionTimelines(context, timelines, state.eventKey, selectEvent),
  );
  const event = state.eventKey
    ? [
        ...(selected?.events ?? []),
        ...timelines.flatMap((timeline) => timeline.events),
      ].find((item) => item.key === state.eventKey)
    : undefined;
  if (state.eventKey && !event)
    content.append(
      element(
        'p',
        'The selected agent event is no longer retained.',
        'warning',
      ),
    );
  return {
    navigation,
    content,
    raw:
      event?.raw ??
      (selected
        ? runSummary(selected)
        : { message: 'No selected agent evidence.' }),
    rawTitle: event ? 'Selected agent event' : 'Selected agent run',
  };
}

const statusLabels: Readonly<Record<AgentRunStatus, string>> = {
  queued: 'Queued',
  running: 'Running',
  finished: 'Finished, reason unknown',
  completed: 'Completed',
  budget: 'Budget reached',
  error: 'Error',
  cancelled: 'Cancelled',
};

const statusTones: Readonly<Record<AgentRunStatus, string>> = {
  queued: 'neutral',
  running: 'neutral',
  finished: 'warning',
  completed: 'neutral',
  budget: 'warning',
  error: 'error',
  cancelled: 'warning',
};

const agentEventLabels: Readonly<Record<string, string>> = {
  'engine.agent.input.accepted': 'Input accepted',
  'engine.agent.input.ignored': 'Input ignored',
  'engine.agent.input.rejected': 'Input rejected',
  'engine.agent.run.started': 'Run started',
  'engine.agent.run.finished': 'Run finished',
  'engine.agent.turn.started': 'Turn started',
  'engine.agent.turn.finished': 'Turn finished',
  'engine.agent.tool.started': 'Tool started',
  'engine.agent.tool.completed': 'Tool completed',
  'engine.agent.ui_change.emitted': 'UI change emitted',
  'engine.agent.ui_change.applied': 'UI change applied',
  'engine.agent.ui_applied.rejected': 'UI acknowledgement rejected',
  'client.agent.input.sent': 'Client sent input',
  'client.agent.ui.applied': 'Client applied UI change',
};

function runRow(
  context: ViewContext,
  run: AgentRunTrace,
  pressed: boolean,
  select: () => void,
): HTMLButtonElement {
  const row = button('', select, 'row-button');
  row.dataset.agentRun = run.key;
  row.dataset.focusKey = `agent-run:${run.key}`;
  row.dataset.focusFallback = 'agent-runs';
  row.setAttribute('aria-pressed', String(pressed));
  const heading = element('span', undefined, 'row-heading');
  heading.append(
    element('span', `Run ${run.runId.slice(0, 12)}`, 'row-title'),
    badge(statusLabels[run.status], statusTones[run.status]),
  );
  row.append(
    heading,
    element('span', runFacts(run).join(' · '), 'row-detail'),
    element(
      'span',
      `${context.appLabel(run.clientId)}${run.missingStart ? ' · Start not retained' : ''}`,
      'row-detail',
    ),
  );
  return row;
}

function runFacts(run: AgentRunTrace): string[] {
  return [
    run.disposition ? humanize(run.disposition) : undefined,
    run.durationMs === undefined ? undefined : duration(run.durationMs),
    plural(turnCount(run), 'turn'),
    plural(toolCallCount(run), 'tool call'),
    tokenSummary(run),
    run.code ? `Code ${run.code}` : undefined,
    run.limit ? `Limit ${run.limit}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

function runDetail(
  context: ViewContext,
  run: AgentRunTrace,
  eventKey: string | undefined,
  select: (event: PanelEvent, runKey?: string) => void,
): HTMLElement {
  const detail = element('section', undefined, 'agent-run-detail');
  detail.setAttribute('aria-label', 'Agent run detail');
  detail.append(
    element('h3', `Run ${run.runId}`),
    factList([
      ['Status', statusLabels[run.status]],
      ['Outcome', run.outcome ? humanize(run.outcome) : 'Not reported'],
      [
        'Disposition',
        run.disposition ? humanize(run.disposition) : 'Not reported',
      ],
      ['Duration', duration(run.durationMs)],
      ['Turns', String(turnCount(run))],
      ['Tool calls', String(toolCallCount(run))],
      ['Tokens', tokenSummary(run) ?? 'Not reported'],
      ['App instance', context.appLabel(run.clientId)],
      ...(run.code ? [['Code', run.code] as const] : []),
      ...(run.limit ? [['Limit', run.limit] as const] : []),
      ...(run.metrics?.unreportedUsageCalls
        ? [
            [
              'Calls without usage',
              String(run.metrics.unreportedUsageCalls),
            ] as const,
          ]
        : []),
    ]),
  );
  if (run.missingStart)
    detail.append(
      element(
        'p',
        'The input that started this run is no longer retained. Earlier events may be missing.',
        'muted small',
      ),
    );
  const turnEvents = new Set(
    run.turns.flatMap((turn) => turn.events.map((event) => event.key)),
  );
  const ownEvents = run.events.filter((event) => !turnEvents.has(event.key));
  detail.append(
    element('h4', 'Run events'),
    eventTable(run.events, ownEvents, eventKey, (event) =>
      select(event, run.key),
    ),
  );
  run.turns.forEach((turn, position) => {
    const section = element('details', undefined, 'agent-turn');
    section.open = true;
    section.dataset.disclosureKey = `agent-turn:${run.key}:${turn.turnId}`;
    section.append(
      element(
        'summary',
        `Turn ${turn.turnIndex ?? position + 1} · ${plural(turn.events.length, 'event')}`,
      ),
      eventTable(run.events, turn.events, eventKey, (event) =>
        select(event, run.key),
      ),
    );
    detail.append(section);
  });
  const selected = run.events.find((event) => event.key === eventKey);
  if (selected)
    detail.append(
      element(
        'p',
        selected.content === undefined
          ? 'No content was retained for this event. Content requires an explicit recording or a content subscription.'
          : 'Recorded content for this event is shown in JSON evidence.',
        'muted small',
      ),
    );
  return detail;
}

function sessionTimelines(
  context: ViewContext,
  timelines: readonly AgentSessionTimeline[],
  eventKey: string | undefined,
  select: (event: PanelEvent) => void,
): HTMLElement {
  const section = element('section', undefined, 'agent-session');
  section.setAttribute('aria-label', 'Agent session timeline');
  section.append(
    element('h3', 'Session timeline'),
    element(
      'p',
      'Agent events that belong to no run, such as ignored or rejected inputs and client events not yet linked to a run.',
      'muted small',
    ),
  );
  if (!timelines.length) {
    section.append(
      element('p', 'No session-level agent events are retained.', 'muted'),
    );
    return section;
  }
  for (const timeline of timelines) {
    const events = timeline.events.slice(-context.pageSize);
    section.append(
      element(
        'h4',
        `${context.appLabel(timeline.clientId)} · ${plural(timeline.events.length, 'event')}`,
      ),
      eventTable(timeline.events, events, eventKey, select),
    );
    if (timeline.events.length > events.length)
      section.append(
        moreButton(
          `Show more session events (${events.length} of ${timeline.events.length})`,
          `agent-more-session:${timeline.clientId}`,
          context.more,
        ),
      );
  }
  return section;
}

function eventTable(
  all: readonly PanelEvent[],
  events: readonly PanelEvent[],
  eventKey: string | undefined,
  select: (event: PanelEvent) => void,
): HTMLElement {
  const table = element('table', undefined, 'agent-events');
  const head = element('thead');
  const headings = element('tr');
  for (const heading of ['Order', 'Event', 'Duration'])
    headings.append(element('th', heading));
  head.append(headings);
  const body = element('tbody');
  const order = new Map(all.map((event, position) => [event.key, position]));
  for (const event of events) {
    const label = agentEventLabel(event);
    const node = button(label, () => select(event), 'agent-event');
    node.setAttribute('aria-label', `Inspect ${label}`);
    node.setAttribute('aria-pressed', String(event.key === eventKey));
    node.dataset.focusKey = `agent-event:${event.key}`;
    node.dataset.focusFallback = 'agent-runs';
    const cell = element('td');
    cell.append(node, element('span', eventFacts(event), 'muted small'));
    const row = element('tr');
    row.append(
      element('td', String((order.get(event.key) ?? 0) + 1)),
      cell,
      element(
        'td',
        event.metadata.durationMs === undefined
          ? ''
          : duration(event.metadata.durationMs),
      ),
    );
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function agentEventLabel(event: PanelEvent): string {
  return Object.hasOwn(agentEventLabels, event.kind)
    ? agentEventLabels[event.kind]
    : eventLabel(event);
}

function eventFacts(event: PanelEvent): string {
  const metadata = event.metadata;
  const word = (value: unknown) => {
    const found = text(value);
    return found ? humanize(found) : undefined;
  };
  return [
    text(metadata.toolName),
    word(metadata.disposition),
    word(metadata.reason),
    word(metadata.outcome),
    word(metadata.code),
    text(metadata.limit) ? `Limit ${text(metadata.limit)}` : undefined,
    event.kind.startsWith('client.agent.') && !event.runId
      ? 'Client event'
      : undefined,
    event.content === undefined ? undefined : 'Content retained',
  ]
    .filter(Boolean)
    .join(' · ');
}

function turnCount(run: AgentRunTrace): number {
  return run.metrics?.turns ?? run.turns.length;
}

function toolCallCount(run: AgentRunTrace): number {
  return (
    run.metrics?.toolCalls ??
    run.events.filter((event) => event.kind === 'engine.agent.tool.started')
      .length
  );
}

function tokenSummary(run: AgentRunTrace): string | undefined {
  const input = run.metrics?.inputTokens;
  const output = run.metrics?.outputTokens;
  if (input === undefined && output === undefined) return undefined;
  return `${input ?? '?'} in / ${output ?? '?'} out tokens`;
}

function runSummary(run: AgentRunTrace) {
  const { events, turns, ...summary } = run;
  return {
    ...summary,
    events: events.length,
    turns: turns.map((turn) => ({
      turnId: turn.turnId,
      turnIndex: turn.turnIndex,
      events: turn.events.length,
    })),
  };
}

function moreButton(
  label: string,
  key: string,
  more: () => void,
): HTMLButtonElement {
  const node = button(label, more);
  node.dataset.focusKey = key;
  node.dataset.focusFallback = 'agent-runs';
  return node;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
