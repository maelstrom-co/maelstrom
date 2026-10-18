import {
  type LayoutViewSelection,
  layoutComparisonView,
} from './layout-comparison-view.js';
import { button, element } from './panel-elements.js';
import {
  duration,
  type EngineTiming,
  type EventIssue,
  errorCategories,
  eventIssue,
  eventLabel,
  type Fields,
  fields,
  groupRequests,
  humanize,
  identity,
  inspectState,
  list,
  numeric,
  type PanelApp,
  type PanelEvent,
  type PanelEvidence,
  type RequestCounterpart,
  type RequestStatus,
  type RequestTrace,
  requestPhases,
  statusLabels,
  text,
} from './panel-model.js';
import { requestComparisonView } from './request-comparison-view.js';

export { button, element } from './panel-elements.js';

export function badge(label: string, tone = 'neutral'): HTMLElement {
  const node = element('span', label, 'badge');
  node.dataset.tone = tone;
  return node;
}
export function factList(
  values: readonly (readonly [string, string])[],
): HTMLElement {
  const dl = element('dl', undefined, 'facts');
  for (const [key, value] of values) {
    const item = element('div');
    item.append(element('dt', key), element('dd', value));
    dl.append(item);
  }
  return dl;
}
function table(
  values: readonly (readonly [string, string])[],
): HTMLTableElement {
  const node = element('table', undefined, 'field-table'),
    body = element('tbody');
  for (const [key, value] of values) {
    const row = element('tr');
    const title = element('th', key);
    title.scope = 'row';
    row.append(title, element('td', value));
    body.append(row);
  }
  node.append(body);
  return node;
}
function empty(message: string): HTMLElement {
  return element('p', message, 'empty');
}
function date(value: unknown): string {
  const at = numeric(value);
  if (at === undefined) return 'Time not reported';
  const time = new Date(at);
  return Number.isNaN(time.getTime())
    ? 'Time not reported'
    : time.toLocaleTimeString();
}
function tone(status: RequestStatus): string {
  return status === 'failed'
    ? 'error'
    : status === 'applied'
      ? 'success'
      : ['applied-with-issues', 'discarded', 'abandoned'].includes(status)
        ? 'warning'
        : 'neutral';
}
function searchable(event: PanelEvent, query: string): boolean {
  return (
    !query ||
    `${event.kind} ${event.requestId ?? ''} ${JSON.stringify(event.metadata)}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
}

export interface ViewContext {
  evidence: PanelEvidence;
  appLabel(id: string): string;
  clientId: string;
  query: string;
  issueCategory?: string;
  requestKey: string;
  pinnedRequest?: string;
  comparison?: RequestComparisonSelection;
  setComparison(selection?: RequestComparisonSelection): void;
  pinRequest(key?: string): void;
  phaseBars: boolean;
  phaseMaximumMs?: number;
  phaseCounterparts?: {
    other: ComparisonSide;
    events: ReadonlyMap<string, RequestCounterpart>;
  };
  setPhaseBars(enabled: boolean): void;
  phasePage?: { requestKey: string; index: number };
  stageTimingLimit?: { requestKey: string; count: number };
  setStageTimingLimit(
    limit: NonNullable<ViewContext['stageTimingLimit']>,
  ): void;
  layoutView?: LayoutViewSelection;
  setLayoutView(view: LayoutViewSelection, eventKey?: string): void;
  selectPhasePage(page: NonNullable<ViewContext['phasePage']>): void;
  eventKey: string;
  instanceKey: string;
  allEvents: boolean;
  pageSize: number;
  live: boolean;
  inspect(app: PanelApp): unknown;
  selectRequest(key: string): void;
  selectEvent(key: string): void;
  selectInstance(clientId: string, instanceId: string): void;
  selectApp(clientId: string): void;
  more(): void;
}
export type ComparisonSide = 'a' | 'b';
export interface ComparisonRequest {
  key: string;
  phaseBars?: boolean;
  eventKey?: string;
  phasePage?: ViewContext['phasePage'];
  stageTimingLimit?: ViewContext['stageTimingLimit'];
  layoutView?: LayoutViewSelection;
}
export interface RequestComparisonSelection {
  a: ComparisonRequest;
  b?: ComparisonRequest;
  choosing: ComparisonSide;
  inspecting: ComparisonSide;
}
export interface RenderedView {
  navigation?: HTMLElement;
  content: HTMLElement;
  raw: unknown;
  rawTitle: string;
  selectedInstance?: { clientId: string; instanceId: string };
  selectedRequestKey?: string;
  contentIdentity?: readonly unknown[];
  comparisonContent?: Partial<
    Record<ComparisonSide, { value: unknown; phaseAvailable: boolean }>
  >;
}

function issueDescription(issue: EventIssue): string {
  const category = issue.category && errorCategories[issue.category];
  return `${humanize(issue.outcome)} · ${category?.label ?? 'Category not reported'}. ${category?.explanation ?? 'This event has no recognized error category.'}`;
}

function matchesCategory(
  issue: EventIssue | undefined,
  category?: string,
): boolean {
  return (
    !category ||
    category === 'all' ||
    Boolean(issue && (issue.category ?? 'unreported') === category)
  );
}

function stageTimingsView(
  timings: readonly EngineTiming[],
  initialLimit: number,
  onMore: (count: number) => void,
): HTMLElement {
  const section = element('section');
  section.setAttribute('aria-label', 'Engine stage timings');
  const rows = factList([]);
  const status = element('p', undefined, 'muted small');
  status.setAttribute('role', 'status');
  let shown = 0;
  const more = button('Show more stage timings', () =>
    showMore(shown + 200, true),
  );
  more.dataset.focusKey = 'more-stage-timings';
  function showMore(limit: number, remember: boolean): void {
    const end = Math.min(limit, timings.length);
    const batch = factList(
      timings
        .slice(shown, end)
        .map((timing) => [timing.label, duration(timing.durationMs)]),
    );
    rows.append(...Array.from(batch.children));
    shown = end;
    status.textContent = `Showing ${shown} of ${timings.length} stage timings`;
    more.disabled = shown === timings.length;
    if (remember) onMore(shown);
  }
  showMore(initialLimit, false);
  section.append(element('h4', 'Engine stages'), rows, status);
  if (timings.length > 200) section.append(more);
  return section;
}

function requestPhasePage(
  request: RequestTrace,
  context: ViewContext,
  phases = requestPhases(request),
): number {
  const selectedIndex = phases.findIndex(
    (phase) => phase.eventKey === context.eventKey,
  );
  return Math.min(
    context.phasePage?.requestKey === request.key
      ? context.phasePage.index
      : Math.floor(Math.max(0, selectedIndex) / 200),
    Math.max(0, Math.ceil(phases.length / 200) - 1),
  );
}

function requestPhasesView(
  request: RequestTrace,
  current: PanelEvent | undefined,
  context: ViewContext,
): HTMLElement {
  const section = element('section', undefined, 'request-phases');
  section.append(
    element('h3', 'Request phases'),
    element(
      'p',
      context.phaseMaximumMs === undefined
        ? 'Observed order, not a shared clock. Bars compare reported durations; nested work overlaps.'
        : 'Observed order, not a shared clock. Both requests share one duration scale. Nested work overlaps.',
      'muted small',
    ),
  );
  const phases = requestPhases(request);
  const maximum =
    context.phaseMaximumMs ??
    phases.reduce((max, phase) => Math.max(max, phase.durationMs ?? 0), 0);
  const table = element('table', undefined, 'phase-table');
  table.setAttribute('aria-label', 'Request phases');
  const header = element('thead'),
    headings = element('tr'),
    body = element('tbody');
  for (const title of [
    'Phase / outcome',
    'Duration',
    ...(context.phaseCounterparts ? ['Other request'] : []),
  ]) {
    const heading = element('th', title);
    heading.scope = 'col';
    headings.append(heading);
  }
  header.append(headings);
  table.append(header, body);
  const barsLabel = element('label', undefined, 'phase-display');
  const bars = element('input');
  bars.type = 'checkbox';
  bars.dataset.focusKey = 'phase-bars';
  bars.checked = context.phaseBars;
  table.dataset.bars = String(bars.checked);
  bars.addEventListener('change', () => {
    table.dataset.bars = String(bars.checked);
    context.setPhaseBars(bars.checked);
  });
  barsLabel.append(bars, document.createTextNode('Show duration bars'));
  const status = element('p', undefined, 'muted small');
  const pageIndex = requestPhasePage(request, context, phases);
  const start = pageIndex * 200;
  const end = Math.min(start + 200, phases.length);
  for (const phase of phases.slice(start, end)) {
    const row = element('tr'),
      name = element('td'),
      timing = element('td');
    const select = button(
      '',
      () => context.selectEvent(phase.eventKey),
      'phase-select',
    );
    select.dataset.focusKey = `phase:${phase.eventKey}`;
    select.setAttribute(
      'aria-pressed',
      String(current?.key === phase.eventKey),
    );
    select.append(
      element('span', phase.lane, 'phase-lane'),
      element('span', phase.label),
      element('span', phase.outcome, 'phase-result'),
    );
    name.append(select);
    timing.append(element('span', duration(phase.durationMs)));
    if (phase.durationMs !== undefined) {
      const track = element('span', undefined, 'phase-track'),
        bar = element('span', undefined, 'phase-bar');
      track.setAttribute('aria-hidden', 'true');
      bar.style.width = `${maximum > 0 ? (phase.durationMs / maximum) * 100 : 0}%`;
      track.append(bar);
      timing.append(track);
    }
    row.append(name, timing);
    if (context.phaseCounterparts) {
      const other = context.phaseCounterparts.other.toUpperCase();
      const labels: Record<RequestCounterpart, string> = {
        unmatched: `Unmatched in retained ${other} evidence`,
        unknown: 'Correspondence unknown',
        incomplete: `Unknown — incomplete ${other} evidence`,
        unavailable: `${other} evidence unavailable`,
      };
      row.append(
        element(
          'td',
          labels[
            context.phaseCounterparts.events.get(phase.eventKey) ?? 'unknown'
          ],
          'phase-counterpart',
        ),
      );
    }
    body.append(row);
  }
  status.textContent = `Showing ${start + 1}–${end} of ${phases.length} observed events`;
  section.append(barsLabel, table, status);
  if (phases.length > 200) {
    const previous = button('Previous phases', () => {
      if (pageIndex > 0)
        context.selectPhasePage({
          requestKey: request.key,
          index: pageIndex - 1,
        });
    });
    previous.setAttribute('aria-disabled', String(pageIndex === 0));
    previous.dataset.focusKey = 'previous-phases';
    const more = button('Show more phases', () => {
      if (end < phases.length)
        context.selectPhasePage({
          requestKey: request.key,
          index: pageIndex + 1,
        });
    });
    more.setAttribute('aria-disabled', String(end === phases.length));
    more.dataset.focusKey = 'more-phases';
    section.append(previous, more);
  }
  return section;
}

function eventDetails(event: PanelEvent, context: ViewContext): HTMLElement {
  const detail = element('section');
  detail.append(element('h3', eventLabel(event)));
  detail.append(
    element(
      'p',
      `${event.clientId ? context.appLabel(event.clientId) : 'App identity not recorded'} · ${date(event.at)}`,
      'muted small',
    ),
  );
  const values: [string, string][] = [];
  for (const [key, value] of Object.entries(event.metadata)) {
    if (
      key === 'clientId' ||
      key === 'providerInstanceId' ||
      key === 'serverAt'
    )
      continue;
    values.push([
      humanize(key),
      key === 'durationMs'
        ? duration(value)
        : value === null || value === undefined
          ? 'Not reported'
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value),
    ]);
  }
  if (values.length) detail.append(table(values));
  const issue = eventIssue(event);
  if (issue) detail.append(element('p', issueDescription(issue), 'warning'));
  const instanceId = text(event.metadata.instanceId);
  const clientId = event.clientId;
  if (clientId && instanceId)
    detail.append(
      button('Inspect this Instance', () =>
        context.selectInstance(clientId, instanceId),
      ),
    );
  const error = text(fields(event.content).error);
  if (error) detail.append(element('p', error, 'warning'));
  else if (
    event.metadata.outcome !== 'cancelled' &&
    (issue?.outcome === 'failed' ||
      event.kind === 'voice.session.error' ||
      event.kind === 'engine.error')
  )
    detail.append(
      element(
        'p',
        event.content !== undefined
          ? 'This event has no error message. Recordings only keep details supplied by the source.'
          : `${issue?.outcome === 'failed' ? 'Error content was' : 'Event details were'} not recorded. Start a recording before reproducing the problem to retain supported details.`,
        'muted small',
      ),
    );
  if (numeric(event.metadata.serverAt) !== undefined)
    detail.append(
      element(
        'p',
        `Server emission: ${date(event.metadata.serverAt)}. Browser observation: ${date(event.at)}. These clocks are independent.`,
        'muted small',
      ),
    );
  return detail;
}

export function requestsView(context: ViewContext): RenderedView {
  const navigation = element('div'),
    content = element('section');
  const scoped = (
    context.allEvents
      ? context.evidence.events
      : (context.evidence.requestEvents ?? context.evidence.events)
  ).filter(
    (event) =>
      context.clientId === 'all' || event.clientId === context.clientId,
  );
  if (context.allEvents) {
    const events = scoped
      .filter(
        (event) =>
          searchable(event, context.query) &&
          matchesCategory(eventIssue(event), context.issueCategory),
      )
      .slice()
      .reverse();
    const selected =
      events.find((event) => event.key === context.eventKey) ?? events[0];
    for (const event of events.slice(0, context.pageSize)) {
      const row = button(
        '',
        () => context.selectEvent(event.key),
        'row-button',
      );
      row.dataset.focusKey = `event:${event.key}`;
      row.setAttribute('aria-pressed', String(selected?.key === event.key));
      row.append(
        element('span', eventLabel(event), 'row-title'),
        element(
          'span',
          `${event.clientId ? context.appLabel(event.clientId) : 'Uncorrelated'} · ${date(event.at)}`,
          'row-detail',
        ),
      );
      navigation.append(row);
    }
    if (events.length > context.pageSize)
      navigation.append(button('Show more events', context.more));
    if (!selected)
      content.append(
        empty(
          'No matching events. Use the application to generate activity, or open a recording.',
        ),
      );
    else content.append(eventDetails(selected, context));
    return {
      navigation,
      content,
      raw: selected?.raw,
      rawTitle: 'Selected event',
      contentIdentity: [
        'event',
        selected?.raw,
        context.clientId,
        ...context.evidence.apps.flatMap((app) => [app.id, app.active]),
      ],
    };
  }
  const retainedRequests = groupRequests(scoped);
  const requests = retainedRequests.filter(
    (request) =>
      (!context.issueCategory ||
        context.issueCategory === 'all' ||
        request.issues.some((issue) =>
          matchesCategory(issue, context.issueCategory),
        )) &&
      (!context.query ||
        `${request.requestId} ${request.intent ?? ''} ${statusLabels[request.status]} ${context.appLabel(request.clientId)}`
          .toLowerCase()
          .includes(context.query.toLowerCase()) ||
        request.events.some((event) => searchable(event, context.query))),
  );
  const selected = context.requestKey
    ? requests.find((request) => request.key === context.requestKey)
    : requests[0];
  const pinned = requests.find(
    (request) => request.key === context.pinnedRequest,
  );
  if (pinned) {
    requests.splice(requests.indexOf(pinned), 1);
    requests.unshift(pinned);
  }
  for (const request of requests.slice(0, context.pageSize)) {
    const row = button(
      '',
      () => context.selectRequest(request.key),
      'row-button',
    );
    row.dataset.focusKey = `request:${request.key}`;
    row.setAttribute(
      'aria-pressed',
      String(
        context.comparison
          ? [context.comparison.a.key, context.comparison.b?.key].includes(
              request.key,
            )
          : selected?.key === request.key,
      ),
    );
    const heading = element('span', undefined, 'row-heading');
    heading.append(
      element(
        'span',
        request.intent?.slice(0, 90) ??
          `${request.push ? 'Push response' : 'Request'} ${request.requestId.slice(0, 10)}`,
        'row-title',
      ),
    );
    row.append(
      heading,
      badge(statusLabels[request.status], tone(request.status)),
      element(
        'span',
        `${context.appLabel(request.clientId)} · ${duration(request.transportMs)}`,
        'row-detail',
      ),
    );
    if (request.key === context.pinnedRequest) row.append(badge('Pinned'));
    for (const side of ['a', 'b'] as const)
      if (context.comparison?.[side]?.key === request.key)
        row.append(badge(side.toUpperCase()));
    navigation.append(row);
  }
  if (requests.length > context.pageSize)
    navigation.append(button('Show more requests', context.more));
  if (context.comparison)
    return requestComparisonView(
      context,
      context.comparison,
      retainedRequests,
      requests,
      navigation,
      requestDetailsView,
    );
  if (!selected) {
    if (context.pinnedRequest)
      content.append(button('Unpin request', () => context.pinRequest()));
    content.append(
      empty(
        context.pinnedRequest
          ? retainedRequests.some(
              (request) => request.key === context.pinnedRequest,
            )
            ? 'Pinned request is hidden by the current filters. Clear the filters to inspect it.'
            : 'Pinned request evidence is no longer retained. Pinning keeps one identity, not a copy of its events. Unpin to select another request.'
          : context.requestKey
            ? 'The selected request is no longer retained or does not match this view. Select another request from the list.'
            : scoped.length > 0
              ? 'No matching requests. Choose All events to inspect connection or voice events. For recording events, first select the recording under Evidence.'
              : 'No requests yet. Interact with your application to see how requests change its UI.',
      ),
    );
    return { navigation, content, raw: undefined, rawTitle: 'Selected event' };
  }
  return { navigation, ...requestDetailsView(selected, context) };
}

function requestDetailsView(
  selected: RequestTrace,
  context: ViewContext,
): RenderedView {
  const current =
    selected.events.find((event) => event.key === context.eventKey) ??
    (context.comparison && context.eventKey
      ? undefined
      : selected.events.at(-1));
  const content = element('section');
  const outcome = element('header', undefined, 'request-outcome');
  outcome.dataset.tone = tone(selected.status);
  outcome.append(
    badge(statusLabels[selected.status], tone(selected.status)),
    element(
      'h3',
      selected.intent ??
        `${selected.push ? 'Push response' : 'Request'} ${selected.requestId.slice(0, 12)}`,
    ),
  );
  const summary: Record<RequestStatus, string> = {
    awaiting: 'Waiting for a client outcome.',
    received:
      'The response arrived. No application outcome has been reported yet.',
    applied: 'The client finished applying the response commands.',
    'applied-with-issues':
      'The client finished applying the response. Some Actions failed or were skipped.',
    failed:
      'The client reported a failure while requesting or applying the response.',
    cancelled: 'The request was cancelled before a response was applied.',
    discarded: 'The client discarded this response. Inspect its reason below.',
    abandoned: 'Client work ended before the response batch completed.',
  };
  outcome.append(element('p', summary[selected.status], 'muted'));
  const pin = button(
    context.pinnedRequest === selected.key ? 'Unpin request' : 'Pin request',
    () =>
      context.pinRequest(
        context.pinnedRequest === selected.key ? undefined : selected.key,
      ),
  );
  pin.dataset.focusKey = 'pin-request';
  pin.setAttribute(
    'aria-pressed',
    String(context.pinnedRequest === selected.key),
  );
  pin.title =
    'Keep this request first in the list. Selecting another request clears the pin. Event retention limits still apply.';
  if (!context.comparison) {
    outcome.append(pin);
    const compare = button('Compare request', () =>
      context.setComparison({
        a: {
          key: selected.key,
          eventKey: current?.key,
          phasePage: {
            requestKey: selected.key,
            index: requestPhasePage(selected, context),
          },
        },
        choosing: 'b',
        inspecting: 'a',
      }),
    );
    compare.dataset.focusKey = 'compare-request';
    outcome.append(compare);
  }
  content.append(outcome);
  const matchingIssues = selected.issues.filter((issue) =>
    matchesCategory(issue, context.issueCategory),
  );
  if (matchingIssues.length) {
    const issues = element('section');
    issues.append(
      element('h3', 'Observed issues'),
      element(
        'p',
        'An operation can fail even when the request later succeeds.',
        'muted small',
      ),
    );
    for (const issue of matchingIssues.slice(0, 30)) {
      const event = selected.events.find(
        (event) => event.key === issue.eventKey,
      );
      if (!event) continue;
      const issueButton = button(
        `${eventLabel(event)}: ${issueDescription(issue)}`,
        () => context.selectEvent(event.key),
        'row-button',
      );
      issueButton.dataset.focusKey = `issue:${event.key}`;
      issueButton.setAttribute(
        'aria-pressed',
        String(context.eventKey === event.key),
      );
      issues.append(issueButton);
    }
    if (matchingIssues.length > 30)
      issues.append(
        element(
          'p',
          `${matchingIssues.length - 30} more issue events. Use All events to inspect them.`,
          'muted small',
        ),
      );
    if (context.comparison) {
      const disclosure = element('details');
      disclosure.dataset.disclosurePurpose = 'issues';
      disclosure.append(
        element('summary', `Observed issues (${matchingIssues.length})`),
        issues,
      );
      content.append(disclosure);
    } else content.append(issues);
  }
  if (
    selected.status === 'discarded' ||
    selected.status === 'abandoned' ||
    selected.status === 'cancelled'
  ) {
    const reason = selected.events
      .slice()
      .reverse()
      .find((event) => text(event.metadata.reason));
    if (reason)
      content.append(
        element(
          'p',
          `Reason: ${humanize(String(reason.metadata.reason))}`,
          'warning',
        ),
      );
  }
  content.append(
    element(
      'p',
      `${selected.succeededActions} observed Actions succeeded · ${selected.observedFailedActions} failed · ${selected.observedSkippedActions} skipped`,
      'muted small',
    ),
    factList([
      [
        'Request round-trip',
        selected.push
          ? 'Not applicable (push)'
          : duration(selected.transportMs),
      ],
      ['Client application', duration(selected.applicationMs)],
    ]),
  );
  const coverage = element('details', undefined, 'help');
  coverage.dataset.disclosurePurpose = 'timings';
  coverage.append(
    element('summary', 'Timings and evidence coverage'),
    factList([
      ['Observed command work', duration(selected.commandMs)],
      ...selected.engineTimings
        .filter((timing) => timing.kind !== 'stage')
        .map((timing): [string, string] => [
          timing.label,
          duration(timing.durationMs),
        ]),
      [
        'Observed Actions · succeeded / failed / skipped',
        `${selected.succeededActions} / ${selected.observedFailedActions} / ${selected.observedSkippedActions}`,
      ],
      [
        'Reported failed / skipped',
        `${selected.failedActions ?? 'Unknown'} / ${selected.skippedActions ?? 'Unknown'}`,
      ],
    ]),
  );
  const stageTimings = selected.engineTimings.filter(
    (timing) => timing.kind === 'stage',
  );
  if (stageTimings.length)
    coverage.append(
      stageTimingsView(
        stageTimings,
        context.stageTimingLimit?.requestKey === selected.key
          ? context.stageTimingLimit.count
          : 200,
        (count) =>
          context.setStageTimingLimit({ requestKey: selected.key, count }),
      ),
    );
  if (selected.missingStart)
    content.append(
      element(
        'p',
        'Partial evidence: the request start is not retained.',
        'warning',
      ),
    );
  const missingOutcome =
    selected.status === 'awaiting' || selected.status === 'received';
  if (missingOutcome)
    content.append(
      element(
        'p',
        'No final client outcome is available. Work may still be running, or its outcome may have left the retained history.',
        'warning',
      ),
    );
  else if (!selected.missingStart)
    content.append(
      element(
        'p',
        selected.push
          ? 'Push receipt and outcome retained. Intermediate events may still be missing.'
          : 'Start and outcome retained. Intermediate events may still be missing.',
        'muted small',
      ),
    );
  const dropped =
    context.evidence.droppedRequestEvents ?? context.evidence.dropped;
  const omitted =
    context.evidence.omittedRequestEvents ?? context.evidence.omitted;
  if (dropped)
    coverage.append(
      element(
        'p',
        `${dropped} ${dropped === 1 ? 'event' : 'events'} dropped or evicted across this evidence source. This count does not identify which requests lost events.`,
        'warning',
      ),
    );
  if (omitted)
    coverage.append(
      element(
        'p',
        `${omitted} earlier events are omitted by the viewer limit across this evidence source.`,
        'warning',
      ),
    );
  if (selected.events.every((event) => !event.kind.startsWith('engine.')))
    coverage.append(
      element(
        'p',
        'No server stages are retained for this request. Server evidence requires a compatible, enabled host.',
        'muted small',
      ),
    );
  if (context.comparison && context.eventKey && !current)
    content.append(
      element(
        'p',
        'Selected phase is no longer retained. Select another phase to inspect its JSON.',
        'warning',
      ),
    );
  const layout = layoutComparisonView(
    selected,
    context.evidence.events,
    context,
  );
  if (context.comparison) {
    const disclosure = element('details');
    disclosure.dataset.disclosurePurpose = 'layout';
    disclosure.append(element('summary', 'Layout changes'), layout);
    content.append(disclosure);
  } else content.append(layout);
  content.append(requestPhasesView(selected, current, context));
  coverage.append(
    element(
      'p',
      'Request round-trip includes the wait for the Engine response. Client application measures the response batch. Command work is the sum of retained command durations and excludes queue time. Nested timings overlap; do not add them together. Each duration uses its emitting process clock.',
    ),
    element(
      'p',
      'Applied means the client command batch finished. It does not establish a browser paint, animation completion, or audible playback.',
    ),
  );
  content.append(coverage);
  if (current) content.append(eventDetails(current, context));
  return {
    content,
    raw: current?.raw,
    rawTitle: 'Selected stage',
    selectedRequestKey: selected.key,
    contentIdentity: [
      'request',
      selected.key,
      context.pinnedRequest,
      context.issueCategory,
      context.eventKey,
      context.phasePage,
      context.stageTimingLimit,
      context.layoutView,
      context.clientId,
      dropped,
      omitted,
      ...selected.events.map((event) => event.raw),
      ...context.evidence.apps.flatMap((app) => [app.id, app.active]),
    ],
  };
}

export function inspectorView(context: ViewContext): RenderedView {
  const navigation = element('div'),
    content = element('section');
  const apps = context.evidence.apps.filter(
    (app) => context.clientId === 'all' || app.id === context.clientId,
  );
  if (apps.length > 1 && context.clientId === 'all') {
    content.append(
      element('h3', 'Choose an app instance'),
      element(
        'p',
        'Each app instance has its own Chart, registry, and retained state.',
        'muted',
      ),
    );
    for (const app of apps) {
      const row = button(
        `${context.appLabel(app.id)} · ${app.active === undefined ? 'recorded' : app.active ? 'active' : 'ended, retained'}`,
        () => context.selectApp(app.id),
        'row-button',
      );
      navigation.append(row);
    }
    return { navigation, content, raw: undefined, rawTitle: 'Selected state' };
  }
  const app = apps[0];
  if (!app) {
    content.append(
      empty(
        'No app state is available. Older recordings may contain events without structural snapshots.',
      ),
    );
    return { content, raw: undefined, rawTitle: 'Selected state' };
  }
  const inspection = context.inspect(app),
    state = inspectState(inspection);
  const instances = state.instances;
  const selected =
    instances.find(
      (instance) =>
        JSON.stringify([app.id, instance.instanceId]) === context.instanceKey,
    ) ?? instances[0];
  navigation.append(element('h3', 'Instances'));
  for (const instance of instances.slice(0, context.pageSize)) {
    const key = JSON.stringify([app.id, instance.instanceId]);
    const row = button(
      '',
      () => context.selectInstance(app.id, instance.instanceId),
      'row-button',
    );
    row.dataset.focusKey = `instance:${key}`;
    row.setAttribute(
      'aria-pressed',
      String(selected?.instanceId === instance.instanceId),
    );
    row.append(
      element(
        'span',
        instance.vesselName ?? instance.vesselId ?? instance.instanceId,
        'row-title',
      ),
      element(
        'span',
        `${instance.variant ?? 'Variant unavailable'} · ${instance.visible === undefined ? 'visibility unknown' : instance.visible ? 'visible' : 'hidden by layout'}`,
        'row-detail',
      ),
    );
    navigation.append(row);
  }
  if (instances.length > context.pageSize)
    navigation.append(button('Show more Instances', context.more));
  content.append(
    element('h3', `${context.appLabel(app.id)} · Chart`),
    element(
      'p',
      `${text(state.layout.type) ? humanize(String(state.layout.type)) : 'Layout unavailable'} · ${state.columns ?? '?'} columns × ${state.rows ?? '?'} rows · schematic preview`,
      'muted small',
    ),
  );
  if (state.tiles !== null && state.tiles.length > 0) {
    const map = element('div', undefined, 'minimap');
    map.setAttribute('aria-label', 'Chart layout preview');
    for (const tile of state.tiles.slice(0, 200)) {
      const instance = instances.find(
        (instance) => instance.instanceId === tile.instanceId,
      );
      const node = button(
        '',
        () => context.selectInstance(app.id, tile.instanceId),
        'tile',
      );
      node.dataset.focusKey = `tile:${app.id}:${tile.instanceId}`;
      node.dataset.instanceId = tile.instanceId;
      node.setAttribute(
        'aria-label',
        `Inspect ${instance?.vesselName ?? instance?.vesselId ?? 'Instance'} ${tile.instanceId}`,
      );
      node.setAttribute(
        'aria-pressed',
        String(selected?.instanceId === tile.instanceId),
      );
      Object.assign(node.style, {
        left: `${tile.x}%`,
        top: `${tile.y}%`,
        width: `${tile.width}%`,
        height: `${tile.height}%`,
      });
      node.append(
        element(
          'span',
          instance?.vesselName ?? instance?.vesselId ?? 'Unknown Instance',
        ),
        element('small', instance?.variant ?? tile.instanceId),
      );
      map.append(node);
    }
    content.append(map);
    if (state.tiles.length > 200)
      content.append(
        element(
          'p',
          'The diagram shows the first 200 tiles. Select an Instance from the list for details.',
          'warning',
        ),
      );
  } else
    content.append(
      element(
        'p',
        state.tiles === null
          ? 'There is not enough layout data to draw the Chart. Inspect the Instance details or JSON.'
          : 'The layout has no visible Instances.',
        'muted',
      ),
    );
  if (selected) {
    content.append(
      element(
        'h3',
        selected.vesselName ?? selected.vesselId ?? selected.instanceId,
      ),
    );
    const size = selected.minSize;
    content.append(
      table([
        ['Vessel', selected.vesselId ?? 'Not retained'],
        ['Variant', selected.variant ?? 'Not retained'],
        [
          'Visibility',
          selected.visible === undefined
            ? 'Unknown'
            : selected.visible
              ? 'Visible in layout'
              : 'Retained, hidden by layout',
        ],
        [
          'Declared minimum',
          numeric(size.width) !== undefined &&
          numeric(size.height) !== undefined
            ? `${size.width} × ${size.height} cells`
            : 'Not retained',
        ],
      ]),
    );
    const capabilities = element('section', undefined, 'capability');
    capabilities.append(element('h3', 'Registered Actions'));
    if (!selected.actions.length)
      capabilities.append(
        element(
          'p',
          Array.isArray(
            fields(fields(selected.definition.variants)[selected.variant ?? ''])
              .actions,
          )
            ? 'No Actions are declared for this Variant.'
            : 'Action definitions are missing. Use live inspection or a recording with a starting snapshot.',
          'muted small',
        ),
      );
    for (const action of selected.actions) {
      capabilities.append(
        element('p', text(action.name) ?? 'Unnamed Action', 'mono'),
      );
      if (text(action.description))
        capabilities.append(
          element('p', String(action.description), 'muted small'),
        );
    }
    content.append(capabilities);
    const technical = element('details', undefined, 'technical');
    technical.append(
      element('summary', 'Instance identity'),
      element('p', selected.instanceId, 'mono'),
    );
    content.append(technical);
  }
  const registry = element('details', undefined, 'help');
  registry.append(
    element('summary', `Registered Vessels · ${state.vessels.length}`),
  );
  for (const vessel of state.vessels) {
    registry.append(
      element('h3', text(vessel.name) ?? text(vessel.id) ?? 'Vessel'),
    );
    const variants = Array.isArray(vessel.variants)
      ? list(vessel.variants)
          .filter((value) => typeof value === 'string')
          .join(', ')
      : Object.keys(fields(vessel.variants)).join(', ');
    registry.append(
      element('p', `Variants: ${variants || 'Not retained'}`, 'muted small'),
    );
  }
  if (!state.vessels.length)
    registry.append(
      element('p', 'This source has no registry definitions.', 'muted'),
    );
  content.append(registry);
  return {
    navigation,
    content,
    raw: selected
      ? {
          instance: selected.raw,
          vessel: selected.definition,
          layout: state.layout,
        }
      : inspection,
    rawTitle: 'Selected Instance and definition',
    selectedInstance: selected
      ? { clientId: app.id, instanceId: selected.instanceId }
      : undefined,
  };
}

export function connectionsView(
  context: ViewContext,
  history: readonly PanelEvent[],
): RenderedView {
  const content = element('section'),
    grid = element('div', undefined, 'connections-grid');
  const apps = context.evidence.apps.filter(
    (app) => context.clientId === 'all' || app.id === context.clientId,
  );
  const events = context.evidence.events.filter(
    (event) =>
      context.clientId === 'all' || event.clientId === context.clientId,
  );
  for (const app of apps) {
    const state = inspectState(app.inspection),
      recent = events
        .filter(
          (event) =>
            event.clientId === app.id &&
            event.kind === 'client.connection.changed',
        )
        .at(-1);
    const connection = element('section', undefined, 'connection');
    connection.append(
      element('h3', `${context.appLabel(app.id)} · Engine`),
      badge(
        (context.live
          ? (state.connection ?? text(recent?.metadata.status))
          : (text(recent?.metadata.status) ?? state.connection)) ??
          'Not reported',
      ),
    );
    const attempts = events.filter(
      (event) =>
        event.clientId === app.id && event.kind === 'client.connection.attempt',
    ).length;
    connection.append(
      factList([
        [
          'App lifetime',
          app.active === undefined
            ? 'Recorded evidence'
            : app.active
              ? 'Active'
              : 'Ended, retained',
        ],
        ['Observed connection attempts', String(attempts)],
      ]),
    );
    grid.append(connection);
  }
  const voices = new Map<string, { event: PanelEvent; metadata: Fields }>();
  for (const event of [...history, ...events]) {
    if (
      !event.kind.startsWith('voice.') ||
      !event.clientId ||
      (context.clientId !== 'all' && event.clientId !== context.clientId)
    )
      continue;
    const provider = identity(event.metadata.providerInstanceId);
    if (!provider) continue;
    const connectionFact =
      event.kind === 'voice.transport' ||
      event.kind === 'voice.observations' ||
      [
        'voice.session.started',
        'voice.session.connected',
        'voice.session.disconnecting',
        'voice.session.disconnected',
        'voice.session.error',
      ].includes(event.kind);
    if (
      !connectionFact &&
      numeric(
        event.metadata.providerGeneration ?? event.metadata.generation,
      ) === undefined
    )
      continue;
    const key = JSON.stringify([
      event.clientId,
      provider,
      event.metadata.providerGeneration !== undefined
        ? 'provider'
        : (event.metadata.generationScope ?? 'legacy'),
      event.metadata.providerGeneration ?? event.metadata.generation ?? null,
    ]);
    const metadata = { ...voices.get(key)?.metadata, ...event.metadata };
    if (event.kind === 'voice.transport' && text(event.metadata.state))
      metadata.transportState = event.metadata.state;
    const lifecycle: Record<string, string> = {
      'voice.session.started': 'connecting',
      'voice.session.connected': 'connected',
      'voice.session.disconnecting': 'disconnecting',
      'voice.session.disconnected': 'disconnected',
      'voice.session.error': 'error',
    };
    if (lifecycle[event.kind]) metadata.connection = lifecycle[event.kind];
    voices.set(key, { event, metadata });
  }
  for (const observation of [...voices.values()].slice(-16).reverse()) {
    const event = observation.event;
    const clientId = event.clientId;
    if (!clientId) continue;
    const connection = element('section', undefined, 'connection');
    const meta = observation.metadata;
    connection.append(
      element(
        'h3',
        `${context.appLabel(clientId)} · ${humanize(text(meta.provider) ?? 'Voice')}`,
      ),
      badge(
        text(meta.connection) ??
          text(meta.transportState) ??
          'State not reported',
      ),
    );
    const values: [string, string][] = [
      [
        meta.providerGeneration !== undefined
          ? 'Provider generation'
          : meta.generationScope === 'session'
            ? 'Session generation'
            : 'Generation',
        numeric(meta.providerGeneration ?? meta.generation)?.toString() ??
          'Not reported',
      ],
    ];
    for (const key of [
      'model',
      'transportState',
      'microphone',
      'planning',
      'applying',
      'playback',
      'playbackState',
      'finalization',
      'usageSeconds',
      'finalUsageSeconds',
      'contextUsageRatio',
    ])
      if (meta[key] !== undefined && meta[key] !== null)
        values.push([humanize(key), String(meta[key])]);
    connection.append(table(values));
    grid.append(connection);
  }
  if (!apps.length && !voices.size)
    grid.append(
      empty('No connection evidence is available for this selection.'),
    );
  content.append(grid);
  if (!voices.size)
    content.append(
      element(
        'p',
        'No voice metadata is available. When connected, voice providers appear here under their app instance.',
        'muted small',
      ),
    );
  content.append(element('h3', 'Recent connection and voice events'));
  for (const event of events
    .filter(
      (event) =>
        event.kind.startsWith('voice.') ||
        event.kind.startsWith('client.connection.'),
    )
    .slice(-15)
    .reverse()) {
    const row = button(
      `${eventLabel(event)} · ${date(event.at)}`,
      () => context.selectEvent(event.key),
      'row-button',
    );
    row.dataset.focusKey = `connection:${event.key}`;
    content.append(row);
  }
  const selected = events.find((event) => event.key === context.eventKey);
  return {
    content,
    raw: selected?.raw ?? {
      connections: apps.map((app) => ({
        appInstance: context.appLabel(app.id),
        state: inspectState(app.inspection).connection ?? null,
      })),
      voice: [...voices.values()].map((observation) => ({
        ...observation.metadata,
        latestObservation: observation.event.raw,
      })),
    },
    rawTitle: selected
      ? 'Selected connection observation'
      : 'Connection evidence',
  };
}
