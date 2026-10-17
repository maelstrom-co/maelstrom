import type { TelemetrySnapshot } from '@maelstrom-co/telemetry';
import { button, element } from './panel-views.js';

const number = new Intl.NumberFormat('en-US');
const states = {
  active: [
    'Active',
    'Accepting facts. Earlier delivery problems appear in the loss ledger.',
  ],
  disabled: [
    'Disabled',
    'No sink configured. This instance collects no facts.',
  ],
  timed_out: [
    'Timed out',
    'The exporter exceeded its deadline. The application must create a new instance to resume delivery.',
  ],
  disposed: [
    'Disposed',
    'The application disposed this instance. Pending and later facts count as disposed.',
  ],
} as const;
const reasons = [
  ['invalid', 'Invalid facts', 'Rejected before entering the queue.'],
  [
    'overflow',
    'Capacity overflow',
    'Refused because the queue and exporter were full.',
  ],
  [
    'exportError',
    'Exporter errors',
    'Lost when the exporter threw or rejected a batch.',
  ],
  [
    'timeout',
    'Exporter deadline',
    'Pending facts abandoned at the exporter deadline.',
  ],
  [
    'disabled',
    'Refused after timeout',
    'New facts refused after delivery stopped.',
  ],
  ['disposed', 'Disposed', 'Pending or new facts lost after disposal.'],
] as const;

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function glyph(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const line = document.createElementNS(svg.namespaceURI, 'path');
  line.setAttribute('d', path);
  svg.append(line);
  return svg;
}

function metric(
  label: string,
  scope: string,
  description: string,
  path: string,
) {
  const card = element('div', undefined, 'telemetry-metric');
  const value = element('dd', '0', 'telemetry-value');
  const note = element('dd', undefined, 'telemetry-metric-note');
  note.append(
    element('span', scope, 'telemetry-scope'),
    document.createTextNode(description),
    glyph(path),
  );
  card.append(element('dt', label), value, note);
  return { card, value };
}

export function createTelemetryDashboard() {
  const root = element('div', undefined, 'telemetry-dashboard');
  const heading = element('div', undefined, 'telemetry-heading');
  const title = element('div');
  title.append(
    element('p', 'Live counters · app telemetry', 'telemetry-eyebrow'),
    element('h2', 'Telemetry delivery'),
  );
  const state = element('dl', undefined, 'telemetry-state');
  const stateItem = element('div');
  const stateValue = element('dd');
  stateValue.setAttribute('aria-live', 'polite');
  stateItem.append(element('dt', 'State', 'telemetry-sr-only'), stateValue);
  state.append(stateItem);
  heading.append(title, state);

  const status = element('div', undefined, 'telemetry-status');
  const headline = element('h3');
  const explanation = element('p');
  status.append(glyph('M3 12h4l3-7 4 14 3-7h4'), headline, explanation);

  const flow = element('dl', undefined, 'telemetry-flow');
  flow.setAttribute('aria-label', 'Delivery flow');
  const metrics = {
    accepted: metric(
      'Accepted',
      'Lifetime',
      'Entered the queue',
      'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
    ),
    queued: metric(
      'Queued',
      'Now',
      'Waiting for the exporter',
      'M4 6h16M4 12h16M4 18h10',
    ),
    exporting: metric(
      'Exporting',
      'Now',
      'Awaiting acknowledgement',
      'M4 12h16m-6-6 6 6-6 6',
    ),
    delivered: metric(
      'Exporter acknowledged',
      'Lifetime',
      'Accepted by the sink',
      'm5 12 4 4L19 6',
    ),
  };
  metrics.delivered.card.classList.add('telemetry-acknowledged');
  flow.append(...Object.values(metrics).map(({ card }) => card));

  const lower = element('div', undefined, 'telemetry-lower');
  const ledger = element('section', undefined, 'telemetry-ledger');
  ledger.setAttribute('aria-label', 'Loss ledger');
  const ledgerHeading = element('div', undefined, 'telemetry-section-heading');
  const total = element('span', undefined, 'telemetry-loss-total');
  ledgerHeading.append(element('h3', 'Loss ledger'), total);
  const empty = element('div', undefined, 'telemetry-no-loss');
  empty.append(
    glyph('m5 12 4 4L19 6'),
    element('span', 'No local losses reported'),
    element('small', 'All six delivery loss counters are zero.'),
  );
  const rows = element('dl', undefined, 'telemetry-loss-rows');
  const lossRows = reasons.map(([key, label, description]) => {
    const row = element('div');
    const value = element('dd', '0', 'telemetry-loss-count');
    const detail = element('dd', description, 'telemetry-loss-description');
    const track = element('dd', undefined, 'telemetry-loss-track');
    const bar = element('span');
    track.setAttribute('aria-hidden', 'true');
    track.append(bar);
    row.append(element('dt', label), value, detail, track);
    rows.append(row);
    return { key, row, value, bar, count: 0 };
  });
  let expanded = false;
  const toggle = button(
    'Show all loss counters',
    () => {
      expanded = !expanded;
      updateDisclosure();
    },
    'telemetry-disclosure',
  );
  function updateDisclosure() {
    setText(
      toggle,
      expanded ? 'Show recorded losses only' : 'Show all loss counters',
    );
    toggle.setAttribute('aria-expanded', String(expanded));
    for (const item of lossRows)
      item.row.hidden = !expanded && item.count === 0;
  }
  ledger.append(ledgerHeading, empty, rows, toggle);

  const guide = element('aside', undefined, 'telemetry-guide');
  guide.append(
    element('span', 'Reading the counts', 'telemetry-eyebrow'),
    element('h3', 'What these counts mean'),
    element(
      'p',
      'Now shows pending work. Lifetime totals include facts that have already left the queue.',
    ),
    element(
      'p',
      'Exporter acknowledgement does not prove backend persistence.',
      'telemetry-persistence',
    ),
  );
  const scope = element('details', undefined, 'telemetry-limits');
  scope.append(
    element('summary', 'Scope and counting rules'),
    element(
      'p',
      'These counters are not included in recordings. They cover the supplied telemetry instance across its producers, independent of app and evidence filters.',
    ),
    element(
      'p',
      'Loss bars compare reported loss reasons, not a failure rate. Some facts are refused before acceptance; disposal can count both pending and new facts.',
    ),
    element(
      'p',
      'Local delivery counters do not measure missing producer observations or diagnostic history.',
    ),
  );
  guide.append(scope);
  lower.append(ledger, guide);
  root.append(
    heading,
    status,
    flow,
    lower,
    element(
      'p',
      'Refreshes every second while this view is open · Flow is schematic',
      'telemetry-refresh',
    ),
  );

  function update(snapshot: TelemetrySnapshot) {
    root.dataset.state = snapshot.state;
    root.dataset.exporting = String(
      snapshot.state === 'active' && snapshot.exporting > 0,
    );
    setText(stateValue, states[snapshot.state][0]);
    setText(explanation, states[snapshot.state][1]);
    const pending = snapshot.queued + snapshot.exporting;
    setText(
      headline,
      snapshot.state === 'active'
        ? pending > 0
          ? `${number.format(pending)} ${pending === 1 ? 'fact' : 'facts'} in flight`
          : snapshot.accepted > 0
            ? 'Queue is clear'
            : 'Ready for the first fact'
        : snapshot.state === 'timed_out'
          ? 'Exporter deadline reached'
          : snapshot.state === 'disposed'
            ? 'Telemetry stopped'
            : 'Telemetry is disabled',
    );
    for (const [key, { card, value }] of Object.entries(metrics)) {
      const count = snapshot[key as keyof typeof metrics];
      setText(value, number.format(count));
      card.dataset.large = String(count >= 1_000_000_000);
    }
    const lost = lossRows.reduce(
      (sum, item) => sum + snapshot.dropped[item.key],
      0,
    );
    root.dataset.loss = String(lost > 0);
    setText(
      total,
      lost
        ? `${number.format(lost)} ${lost === 1 ? 'fact' : 'facts'} lost`
        : '0 lost',
    );
    empty.hidden = lost > 0;
    for (const item of lossRows) {
      item.count = snapshot.dropped[item.key];
      item.row.dataset.loss = String(item.count > 0);
      setText(item.value, number.format(item.count));
      item.bar.style.width = `${lost ? (item.count / lost) * 100 : 0}%`;
    }
    updateDisclosure();
  }
  return { element: root, update };
}

export function telemetryMessage(
  title: string,
  description: string,
  setup = false,
): HTMLElement {
  const message = element('div', undefined, 'telemetry-message');
  message.append(
    glyph(
      setup ? 'M8 3H4v18h4m8-18h4v18h-4M9 12h6' : 'M12 8v5m0 3v1M12 3 2 21h20Z',
    ),
    element('h2', title),
    element('p', description),
  );
  if (setup) message.append(element('code', 'devtools({ telemetry })'));
  return message;
}
