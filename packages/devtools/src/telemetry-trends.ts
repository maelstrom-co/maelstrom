import { button, element } from './panel-elements.js';
import { createTelemetryChart } from './telemetry-chart.js';
import {
  losses,
  TELEMETRY_HISTORY_LIMIT,
  type TelemetrySample,
  type TelemetryWindow,
} from './telemetry-history.js';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const seconds = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 });
const time = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function createTelemetryTrends() {
  const root = element('section', undefined, 'telemetry-trends');
  root.setAttribute('aria-label', 'Telemetry delivery trends');
  const heading = element('div', undefined, 'telemetry-trend-heading');
  const title = element('div');
  const windowLabel = element('p', undefined, 'telemetry-window');
  const times = element('p', undefined, 'telemetry-window-times');
  title.append(element('h3', 'Delivery trends'), windowLabel, times);
  const follow = button('Follow latest', () => {
    selected = undefined;
    renderSelection();
  });
  heading.append(title, follow);
  const gaps = element('p', undefined, 'telemetry-gaps');
  const retention = element('p', undefined, 'telemetry-retention');
  const totals = element('dl', undefined, 'telemetry-window-totals');
  totals.setAttribute('aria-label', 'Observed interval totals');
  const values = (
    [
      ['Accepted in window', 'accepted'],
      ['Acknowledged in window', 'delivered'],
      ['Lost in window', 'lost'],
    ] as const
  ).map(([label, key]) => {
    const item = element('div');
    const value = element('dd');
    item.append(element('dt', label), value);
    totals.append(item);
    return { value, key };
  });
  const queue = createTelemetryChart(
    'Queue depth and exporter activity',
    [
      {
        label: 'Queued',
        color: 'var(--accent)',
        value: (sample) => sample.snapshot?.queued,
      },
      {
        label: 'Exporting',
        color: 'var(--muted)',
        value: (sample) => sample.snapshot?.exporting,
      },
    ],
    select,
  );
  const rates = createTelemetryChart(
    'Local delivery rates',
    [
      {
        label: 'Accepted/s',
        color: 'var(--text)',
        value: (sample) =>
          sample.interval && sample.interval.accepted / sample.interval.seconds,
      },
      {
        label: 'Acknowledged/s',
        color: 'var(--accent)',
        value: (sample) =>
          sample.interval &&
          sample.interval.delivered / sample.interval.seconds,
      },
      {
        label: 'Lost/s',
        color: 'var(--warning)',
        value: (sample) =>
          sample.interval && sample.interval.lost / sample.interval.seconds,
      },
    ],
    select,
  );
  const charts = element('div', undefined, 'telemetry-charts');
  charts.append(queue.element, rates.element);
  const table = element('table');
  table.setAttribute('aria-label', 'Telemetry samples');
  const tableHead = element('thead');
  const labels = element('tr');
  for (const label of [
    'Sample',
    'Local time',
    'Queued',
    'Exporting',
    'Accepted',
    'Acknowledged',
    'Lost',
    'State / gap',
  ])
    labels.append(element('th', label));
  tableHead.append(labels);
  const body = element('tbody');
  table.append(tableHead, body);
  const tableScroll = element('div', undefined, 'telemetry-sample-scroll');
  tableScroll.append(table);
  const details = element('section', undefined, 'telemetry-sample-detail');
  details.setAttribute('aria-label', 'Selected telemetry sample');
  details.setAttribute('role', 'region');
  const sampleTitle = element('h4', 'Sample counters');
  const sampleNote = element('p');
  sampleNote.setAttribute('role', 'status');
  const intervalHeading = element('h5', 'Since previous sample');
  const intervalNote = element('p');
  const intervalFacts = element('dl', undefined, 'telemetry-sample-interval');
  intervalFacts.setAttribute('aria-label', 'Selected sample interval');
  const elapsed = element('dd');
  const duration = element('div');
  duration.append(element('dt', 'Elapsed time'), elapsed);
  intervalFacts.append(duration);
  const intervalValues = (
    [
      ['Accepted', 'accepted'],
      ['Acknowledged', 'delivered'],
      ['Lost', 'lost'],
    ] as const
  ).map(([label, key]) => {
    const item = element('div');
    const value = element('dd');
    item.append(element('dt', label), value);
    intervalFacts.append(item);
    return { value, key };
  });
  const countersHeading = element('h5', 'Exact counters');
  const json = element('pre');
  json.tabIndex = 0;
  details.append(
    sampleTitle,
    sampleNote,
    intervalHeading,
    intervalNote,
    intervalFacts,
    countersHeading,
    json,
  );
  const exploration = element('div', undefined, 'telemetry-exploration');
  exploration.append(tableScroll, details);
  root.append(
    heading,
    retention,
    gaps,
    totals,
    charts,
    element(
      'p',
      'Window totals and rates cover observed intervals only. Lifetime counters appear above.',
      'telemetry-retention',
    ),
    exploration,
  );
  let current: TelemetryWindow | undefined;
  let selected: number | undefined;
  const rows = new Map<
    number,
    { row: HTMLTableRowElement; control: HTMLButtonElement }
  >();

  function select(sequence: number) {
    selected = sequence;
    renderSelection();
  }

  function renderSelection() {
    if (!current) return;
    const sample =
      selected === undefined
        ? current.samples.at(-1)
        : current.samples.find((sample) => sample.sequence === selected);
    follow.setAttribute('aria-pressed', String(selected === undefined));
    const tabStop = sample?.sequence ?? current.samples.at(-1)?.sequence;
    for (const [sequence, { control }] of rows) {
      control.setAttribute(
        'aria-pressed',
        String(sequence === sample?.sequence),
      );
      control.tabIndex = sequence === tabStop ? 0 : -1;
    }
    sampleTitle.textContent = sample
      ? `Sample ${sample.sequence} · ${time.format(sample.at)}`
      : 'Sample expired';
    const note = !sample
      ? 'Selected sample expired. Choose a retained sample or follow latest.'
      : sample.snapshot
        ? `${sample.snapshot.state} · ${sample.gap ?? 'Exact counters at this observation'}`
        : 'Counters unavailable for this sample';
    if (sampleNote.textContent !== note) sampleNote.textContent = note;
    const interval = sample?.interval;
    intervalFacts.hidden = !interval;
    intervalNote.hidden = !!interval;
    intervalNote.textContent = !sample
      ? 'Interval evidence expired with the selected sample.'
      : sample.gap
        ? `No comparable interval: ${sample.gap}.`
        : current.expired && sample === current.samples[0]
          ? 'The previous observation expired. This sample is now the baseline.'
          : 'No comparable interval for this sample.';
    if (interval) {
      elapsed.textContent = `${seconds.format(interval.seconds)} s`;
      for (const { value, key } of intervalValues)
        value.textContent = `+${number.format(interval[key])} · ${number.format(interval[key] / interval.seconds)}/s`;
    }
    const text = sample?.snapshot
      ? JSON.stringify(sample.snapshot, null, 2)
      : '';
    if (json.textContent !== text) json.textContent = text;
    countersHeading.hidden = !sample?.snapshot;
    json.hidden = !sample?.snapshot;
    queue.update(current.samples, sample?.sequence);
    rates.update(current.samples, sample?.sequence);
  }

  function addRow(sample: TelemetrySample) {
    const row = element('tr');
    const control = button(`Sample ${sample.sequence}`, () =>
      select(sample.sequence),
    );
    control.setAttribute(
      'aria-label',
      `Select telemetry sample ${sample.sequence}`,
    );
    control.addEventListener('keydown', (event) => {
      if (!current) return;
      const index = current.samples.findIndex(
        (entry) => entry.sequence === sample.sequence,
      );
      const moves: Record<string, number> = {
        ArrowRight: index + 1,
        ArrowDown: index + 1,
        ArrowLeft: index - 1,
        ArrowUp: index - 1,
        Home: 0,
        End: current.samples.length - 1,
      };
      const next = moves[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const target =
        current.samples[
          Math.max(0, Math.min(current.samples.length - 1, next))
        ];
      if (!target) return;
      select(target.sequence);
      rows.get(target.sequence)?.control.focus();
    });
    const action = element('td');
    action.append(control);
    row.append(action, element('td', time.format(sample.at)));
    const snapshot = sample.snapshot;
    for (const count of [
      snapshot?.queued,
      snapshot?.exporting,
      snapshot?.accepted,
      snapshot?.delivered,
      snapshot && losses(snapshot),
    ])
      row.append(
        element('td', count === undefined ? '—' : number.format(count)),
      );
    row.append(
      element('td', sample.gap ?? snapshot?.state ?? 'Read unavailable'),
    );
    body.append(row);
    rows.set(sample.sequence, { row, control });
  }

  return {
    element: root,
    update(window: TelemetryWindow) {
      current = window;
      windowLabel.textContent = `${window.samples.length} samples · ${number.format(window.seconds)} s observed`;
      const first = window.samples[0];
      const last = window.samples.at(-1);
      times.textContent =
        first && last
          ? `${time.format(first.at)}–${time.format(last.at)} local time`
          : '';
      retention.textContent = `Up to ${TELEMETRY_HISTORY_LIMIT} local samples${window.expired ? ` · ${window.expired} older samples expired` : ''}. Sampling pauses when this view closes.`;
      gaps.textContent = [
        ...new Set(
          window.samples.flatMap((sample) => (sample.gap ? [sample.gap] : [])),
        ),
      ].join(' · ');
      gaps.hidden = !gaps.textContent;
      for (const { value, key } of values) {
        const count = window[key];
        value.textContent =
          window.seconds > 0
            ? `+${number.format(count)} · ${number.format(count / window.seconds)}/s`
            : 'No comparable interval yet';
      }
      const retained = new Set(window.samples.map((sample) => sample.sequence));
      for (const [sequence, { row, control }] of rows) {
        if (retained.has(sequence)) continue;
        const tree = root.getRootNode();
        if ('activeElement' in tree && tree.activeElement === control)
          follow.focus();
        row.remove();
        rows.delete(sequence);
      }
      for (const sample of window.samples)
        if (!rows.has(sample.sequence)) addRow(sample);
      renderSelection();
      if (selected === undefined && !tableScroll.matches(':focus-within'))
        tableScroll.scrollTop = tableScroll.scrollHeight;
    },
  };
}
