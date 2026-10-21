import { button, element } from './panel-elements.js';
import { duration } from './panel-model.js';
import type { RenderedView, ViewContext } from './panel-views.js';
import {
  OVERVIEW_PAGE_SIZE,
  type OverviewFilters,
  type OverviewMeasure,
  type OverviewOutcome,
  type OverviewRow,
  type OverviewWindow,
  overviewMeasures,
  requestOverview,
} from './request-overview.js';
import {
  requestOutcomeLabels,
  requestOutcomeTones,
  requestTimingLabels,
} from './request-presentation.js';

export interface OverviewState extends OverviewFilters {
  sourceToken?: string;
}
export function initialOverviewState(): OverviewState {
  return {
    measure: 'round-trip',
    outcome: 'all',
    timing: 'all',
    query: '',
    page: 0,
  };
}

function time(value: number | undefined): string {
  return value === undefined
    ? 'Not reported'
    : new Date(value).toLocaleString();
}
function windowLabel(
  window: OverviewWindow,
  appLabel: ViewContext['appLabel'],
): string {
  if (window.kind === 'empty') return 'No retained request window.';
  return window.kind === 'client-time'
    ? `${appLabel(window.clientId)} · reported client time ${time(window.from)} – ${time(window.to)}`
    : `Request evidence positions ${window.from + 1}–${window.to + 1}. ${window.reason === 'multiple-clocks' ? 'Multiple app or session clocks.' : 'Some client timestamps are unavailable.'}`;
}

export function createRequestOverviewControls() {
  const root = element('div', undefined, 'overview-controls');
  let state: OverviewState = initialOverviewState();
  let change: (next: OverviewState) => void = () => {};
  const select = (
    name: string,
    options: Readonly<Record<string, string>>,
    update: (value: string) => OverviewState,
  ) => {
    const label = element('label', name);
    const node = element('select');
    node.setAttribute('aria-label', `Overview ${name.toLowerCase()}`);
    node.dataset.focusKey = name;
    for (const [value, text] of Object.entries(options)) {
      const option = element('option', text);
      option.value = value;
      node.append(option);
    }
    node.addEventListener('change', () =>
      change({ ...update(node.value), page: 0 }),
    );
    label.append(node);
    root.append(label);
    return node;
  };
  const measure = select('Timing measure', overviewMeasures, (value) => ({
    ...state,
    measure: value as OverviewMeasure,
  }));
  const outcome = select(
    'Outcome',
    { all: 'All outcomes', ...requestOutcomeLabels },
    (value) => ({ ...state, outcome: value as OverviewOutcome | 'all' }),
  );
  const timing = select(
    'Timing availability',
    {
      all: 'All timings',
      reported: 'Reported timing',
      unreported: 'Timing not reported',
    },
    (value) => ({ ...state, timing: value as OverviewFilters['timing'] }),
  );
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'Request ID or recorded intent';
  search.setAttribute('aria-label', 'Search overview requests');
  search.dataset.focusKey = 'Search overview requests';
  search.addEventListener('input', () =>
    change({ ...state, query: search.value, page: 0 }),
  );
  root.append(search);
  root.append(
    button('Reset overview filters', () =>
      change({
        ...initialOverviewState(),
        sourceToken: state.sourceToken,
        clientId: state.clientId,
      }),
    ),
  );
  return {
    element: root,
    update(next: OverviewState, update: typeof change) {
      state = next;
      change = update;
      measure.value = next.measure ?? 'round-trip';
      outcome.value = next.outcome ?? 'all';
      timing.value = next.timing ?? 'all';
      if (search.value !== (next.query ?? '')) search.value = next.query ?? '';
    },
  };
}

const namespace = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
) {
  const node = document.createElementNS(namespace, tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  return node;
}

export function requestOverviewView(
  context: ViewContext,
  state: OverviewState,
  change: (next: OverviewState) => void,
  openRequest: (key: string) => void,
  controls: ReturnType<typeof createRequestOverviewControls>,
): RenderedView {
  const view = requestOverview(context.evidence, {
    ...state,
    clientId: context.clientId,
  });
  controls.update(state, change);
  const content = element('section', undefined, 'request-overview');
  content.setAttribute('aria-label', 'Retained request overview');
  const summary = element('div', undefined, 'overview-summary');
  for (const text of [
    `${view.retained} retained request${view.retained === 1 ? '' : 's'}`,
    `${view.matched} matching`,
    `${view.hidden} hidden by filters`,
    `${view.missingTimings} timing${view.missingTimings === 1 ? '' : 's'} not reported`,
  ])
    summary.append(element('span', text));
  content.append(
    summary,
    element(
      'p',
      `First retained observations per request: ${windowLabel(view.window, context.appLabel)}`,
      'muted small',
    ),
  );
  content.append(
    element(
      'p',
      `${context.evidence.requestEvents ? 'Request-event' : 'Recording-event'} loss: ${view.loss.dropped === undefined ? 'not reported' : `${view.loss.dropped} dropped or evicted`}; ${view.loss.omitted === undefined ? 'omission count not reported' : `${view.loss.omitted} omitted from this view`}; ${view.loss.unreadable === undefined ? 'unreadable count not reported' : `${view.loss.unreadable} unreadable events`}. ${context.evidence.requestEvents ? '' : 'Request-specific loss is not reported. '}Counts describe this retained evidence source.`,
      'muted small',
    ),
  );
  if (view.unassigned)
    content.append(
      element(
        'p',
        `${view.unassigned} observations in the recent activity sample have missing or withheld app/request identities. They are excluded from request counts.`,
        'muted small',
      ),
    );
  if (!view.matched) {
    content.append(
      element(
        'p',
        view.retained
          ? 'No requests match these filters.'
          : view.unassigned
            ? 'Request observations are retained, but their identities are unavailable. Inspect All events in Requests to see their projected metadata.'
            : 'No retained request identities. Use the application or select a recording.',
        'empty',
      ),
    );
    return {
      controls: controls.element,
      content,
      raw: undefined,
      rawTitle: 'Request overview',
    };
  }
  const timed = view.rows.filter(
    (
      row,
    ): row is OverviewRow & {
      timing: { kind: 'reported'; durationMs: number };
    } => row.timing.kind === 'reported',
  );
  const maximum = Math.max(1, ...timed.map((row) => row.timing.durationMs));
  const figure = element('figure', undefined, 'overview-figure');
  const scroll = element('div', undefined, 'overview-plot-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', 'Request duration chart');
  scroll.dataset.scrollKey = 'request-overview-chart';
  const plot = element('div', undefined, 'overview-plot');
  const grid = svg('svg', {
    viewBox: '0 0 600 210',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  for (const fraction of [0, 0.5, 1]) {
    const y = 170 - fraction * 145;
    const label = element(
      'span',
      duration(maximum * fraction),
      'overview-axis-label',
    );
    label.style.top = `${y / 2.1}%`;
    plot.append(label);
    grid.append(
      svg('line', {
        x1: '76',
        x2: '580',
        y1: String(y),
        y2: String(y),
        class: 'overview-gridline',
      }),
    );
  }
  plot.append(grid);
  if (view.plotWindow.kind !== 'empty') {
    const axis = element('div', undefined, 'overview-x-axis');
    const window = view.plotWindow;
    const label = (value: number) =>
      window.kind === 'client-time'
        ? new Date(value).toLocaleTimeString()
        : `Position ${value + 1}`;
    axis.append(
      element('span', label(window.from)),
      element('span', label(window.to)),
    );
    plot.append(axis);
  }
  const points: HTMLButtonElement[] = [];
  for (const row of timed) {
    const range = view.plotWindow;
    const value =
      range.kind === 'client-time' ? (row.at ?? range.from) : row.firstIndex;
    const from = range.kind === 'empty' ? 0 : range.from;
    const to = range.kind === 'empty' ? 0 : range.to;
    const x = 76 + (to === from ? 0.5 : (value - from) / (to - from)) * 504;
    const y = 170 - (row.timing.durationMs / maximum) * 145;
    const label = `Inspect request ${row.request.requestId} from ${context.appLabel(row.request.clientId)}: ${requestOutcomeLabels[row.outcome]}, ${duration(row.timing.durationMs)}`;
    const point = button(
      '',
      () => openRequest(row.request.key),
      'overview-point',
    );
    point.setAttribute('aria-label', label);
    point.title = label;
    point.dataset.tone = requestOutcomeTones[row.outcome];
    point.dataset.focusKey = `overview:${row.request.key}`;
    point.tabIndex = points.length ? -1 : 0;
    point.style.left = `${x / 6}%`;
    point.style.top = `${y / 2.1}%`;
    point.addEventListener('keydown', (event) => {
      const index = points.indexOf(point);
      const next =
        event.key === 'ArrowRight'
          ? Math.min(points.length - 1, index + 1)
          : event.key === 'ArrowLeft'
            ? Math.max(0, index - 1)
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? points.length - 1
                : undefined;
      if (next === undefined) return;
      event.preventDefault();
      for (const item of points) item.tabIndex = -1;
      points[next].tabIndex = 0;
      points[next].focus();
    });
    points.push(point);
    plot.append(point);
    point.dataset.focusFallback = 'Timing measure';
    point.addEventListener('focus', () => {
      for (const item of points) item.tabIndex = item === point ? 0 : -1;
    });
  }
  scroll.append(plot);
  figure.append(
    element('h3', overviewMeasures[state.measure ?? 'round-trip']),
    scroll,
  );
  if (!timed.length)
    plot.replaceChildren(
      element(
        'p',
        'No reported timing on this page. Requests remain available in the table.',
        'overview-no-timing muted',
      ),
    );
  figure.append(
    element(
      'figcaption',
      `${timed.length} plotted on this page. ${view.plotWindow.kind === 'client-time' ? 'Horizontal position uses reported client time.' : 'Horizontal position uses retained observation order.'} Durations are reported separately by their producer. Requests without this timing remain in the table. Overlapping points can be selected in the table.`,
      'muted small',
    ),
  );
  content.append(figure);
  const outcomes = element('div', undefined, 'overview-outcomes');
  outcomes.setAttribute('aria-label', 'Outcomes on this page');
  outcomes.setAttribute('role', 'group');
  outcomes.append(element('span', 'This page:'));
  const counts = new Map<OverviewOutcome, number>();
  for (const row of view.rows)
    counts.set(row.outcome, (counts.get(row.outcome) ?? 0) + 1);
  for (const [outcome, count] of counts) {
    const label = element('span', `${requestOutcomeLabels[outcome]} ${count}`);
    label.dataset.tone = requestOutcomeTones[outcome];
    outcomes.append(label);
  }
  content.append(outcomes);
  const tableScroll = element('div', undefined, 'overview-table-scroll');
  tableScroll.tabIndex = 0;
  tableScroll.setAttribute('aria-label', 'Retained request table');
  tableScroll.dataset.scrollKey = 'request-overview-table';
  const table = element('table', undefined, 'overview-table');
  const head = element('thead'),
    heading = element('tr'),
    body = element('tbody');
  for (const text of [
    'Request',
    'App',
    'Outcome',
    overviewMeasures[state.measure ?? 'round-trip'],
    'First retained client time',
    'Evidence',
  ]) {
    const cell = element('th', text);
    cell.scope = 'col';
    heading.append(cell);
  }
  head.append(heading);
  for (const row of view.rows) {
    const line = element('tr');
    const request = element('td');
    const link = button(row.request.requestId.slice(0, 24), () =>
      openRequest(row.request.key),
    );
    link.setAttribute(
      'aria-label',
      `Open request ${row.request.requestId} from ${context.appLabel(row.request.clientId)}`,
    );
    link.dataset.focusKey = `overview-row:${row.request.key}`;
    request.append(link);
    line.append(request);
    for (const value of [
      context.appLabel(row.request.clientId),
      requestOutcomeLabels[row.outcome],
      row.timing.kind === 'reported'
        ? duration(row.timing.durationMs)
        : requestTimingLabels[row.timing.reason],
      time(row.at),
      row.outcome === 'ambiguous'
        ? 'Conflicting identity'
        : row.outcome === 'unknown'
          ? 'Outcome not established'
          : row.request.push
            ? 'Push response; no request start expected'
            : row.request.missingStart
              ? 'Start not retained'
              : 'Start retained',
    ])
      line.append(element('td', value));
    body.append(line);
  }
  table.append(head, body);
  tableScroll.append(table);
  content.append(tableScroll);
  const paging = element('nav', undefined, 'overview-paging');
  paging.setAttribute('aria-label', 'Overview pages');
  const previous = button('Previous overview page', () =>
    change({ ...state, page: view.page - 1 }),
  );
  previous.disabled = view.page === 0;
  const next = button('Next overview page', () =>
    change({ ...state, page: view.page + 1 }),
  );
  next.disabled = view.page + 1 >= view.pages;
  if (!previous.disabled) previous.dataset.focusKey = 'overview-previous-page';
  if (!next.disabled) next.dataset.focusKey = 'overview-next-page';
  previous.dataset.focusFallback = next.dataset.focusFallback =
    'Timing measure';
  paging.append(
    previous,
    element(
      'span',
      view.matched
        ? `Showing ${view.page * OVERVIEW_PAGE_SIZE + 1}–${view.page * OVERVIEW_PAGE_SIZE + view.rows.length} of ${view.matched} matches`
        : 'No matching requests',
      'muted small',
    ),
    next,
  );
  content.append(paging);
  return {
    controls: controls.element,
    content,
    raw: undefined,
    rawTitle: 'Request overview',
  };
}
