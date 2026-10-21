import { expect, test } from 'bun:test';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { fireEvent } from '@testing-library/react';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { event, mount, attach } = createVoicePanelHarness();
function importEvents(events: unknown[], droppedEvents?: number) {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: { schemaVersion: 1, events, droppedEvents },
    }),
  );
  const view = mount(tools);
  view.select('Evidence source', 'imported');
  return { tools, ...view };
}

test('ambiguous request drill-down preserves evidence without presenting a definitive aggregate', () => {
  const { shadow, click } = importEvents([
    event('start', 'client.request.started', {}, 'duplicate'),
    event(
      'first',
      'client.response.applied',
      { durationMs: 3, actionFailures: 0, skippedActions: 0 },
      'duplicate',
    ),
    event('second', 'client.response.failed', { durationMs: 7 }, 'duplicate'),
  ]);
  expect(shadow.querySelector('.request-outcome')?.textContent).toContain(
    'Ambiguous request evidence',
  );
  expect(
    Array.from(shadow.querySelectorAll('button')).some(
      (node) => node.textContent === 'Compare request',
    ),
  ).toBe(false);
  click('Raw JSON');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    '"durationMs": 7',
  );
});

test('Overview keeps missing timing visible and opens the exact retained request without recording', () => {
  const { tools, shadow, click } = importEvents([
    event('start', 'client.request.started', {}, 'slow'),
    event(
      'response',
      'client.response.received',
      { source: 'request', durationMs: 50 },
      'slow',
    ),
    event(
      'applied',
      'client.response.applied',
      { durationMs: 6, actionFailures: 0, skippedActions: 0 },
      'slow',
    ),
    event('waiting', 'client.request.started', {}, 'waiting'),
  ]);
  click('Overview');
  expect(shadow.querySelector('.request-overview')?.textContent).toContain(
    '2 retained requests',
  );
  expect(shadow.querySelector('.request-overview')?.textContent).toContain(
    '1 timing not reported',
  );
  click('Open request slow from App instance 1');
  expect(shadow.querySelector('.request-outcome')?.textContent).toContain(
    'slow',
  );
  expect(tools.capture.getSnapshot().count).toBe(0);
});

test('Overview uses the request buffer and keeps editing controls connected through live updates', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 2,
    maxRequestEvents: 40,
  });
  const emit = attach(tools);
  const view = mount(tools);
  for (const requestId of ['one', 'two', 'three']) {
    emit('client.request.started', {}, requestId);
    emit(
      'client.response.received',
      { source: 'request', durationMs: 20 },
      requestId,
    );
    emit(
      'client.response.applied',
      { durationMs: 3, actionFailures: 0, skippedActions: 0 },
      requestId,
    );
  }
  view.click('Overview');
  expect(view.shadow.querySelector('.request-overview')?.textContent).toContain(
    '3 retained requests',
  );
  expect(view.shadow.querySelector('.request-overview')?.textContent).toContain(
    '0 dropped or evicted',
  );
  const input = view.shadow.querySelector<HTMLInputElement>(
    'input[aria-label="Search overview requests"]',
  );
  expect(input).not.toBeNull();
  input?.focus();
  fireEvent.input(input as HTMLInputElement, { target: { value: 'three' } });
  emit('client.request.started', {}, 'four');
  expect(
    view.shadow.querySelector('input[aria-label="Search overview requests"]'),
  ).toBe(input);
  expect(input?.value).toBe('three');
  expect(view.shadow.activeElement).toBe(input);
  expect(view.shadow.querySelector('.overview-summary')?.textContent).toContain(
    '1 matching',
  );
  expect(view.shadow.querySelector('.overview-summary')?.textContent).toContain(
    '3 hidden by filters',
  );
});

test('Overview filters survive request navigation and reset for a replaced import', () => {
  const view = importEvents([
    event('failed', 'client.request.failed', { durationMs: 12 }, 'bad'),
    event(
      'applied',
      'client.response.applied',
      { durationMs: 3, actionFailures: 0, skippedActions: 0 },
      'good',
    ),
  ]);
  view.click('Overview');
  view.select('Overview outcome', 'failed');
  expect(view.shadow.querySelector('.overview-summary')?.textContent).toContain(
    '1 matching',
  );
  view.click('Open request bad from App instance 1');
  view.click('Overview');
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      'select[aria-label="Overview outcome"]',
    )?.value,
  ).toBe('failed');
  view.tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [event('new', 'client.request.started', {}, 'new')],
      },
    }),
  );
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      'select[aria-label="Overview outcome"]',
    )?.value,
  ).toBe('all');
  expect(view.shadow.querySelector('.overview-summary')?.textContent).toContain(
    '1 retained request',
  );
});

test.each([
  'repeated-receipt',
  'conflicting-completion',
])('ambiguous %s keeps observation durations out of the request summary', (kind) => {
  const events = [
    event(
      'one',
      'client.response.received',
      { source: 'request', durationMs: 10 },
      'reused',
    ),
  ];
  if (kind === 'repeated-receipt') {
    events.push(
      event(
        'two',
        'client.response.received',
        { source: 'request', durationMs: 99 },
        'reused',
      ),
    );
    events.push(
      event(
        'end',
        'client.response.applied',
        { durationMs: 3, actionFailures: 0, skippedActions: 0 },
        'reused',
      ),
    );
  } else
    events.push(
      event(
        'end',
        'client.request.failed',
        { outcome: 'failed', durationMs: 99 },
        'reused',
      ),
    );
  const view = importEvents(events);
  view.click('Overview');
  view.click('Open request reused from App instance 1');
  const row = view.shadow.querySelector('.list-pane .row-button');
  expect(row?.textContent).toContain('Conflicting identity');
  expect(row?.textContent).not.toContain('99 ms');
  expect(row?.textContent).not.toContain('10 ms');
  view.click('Response received');
  view.click('Raw JSON');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"durationMs": 10',
  );
});

test('discarded push evidence needs no receipt or missing-start warning', () => {
  const view = importEvents([
    event(
      'discarded',
      'client.response.discarded',
      { source: 'push', reason: 'disposed' },
      'push',
    ),
  ]);
  view.click('Overview');
  const table = view.shadow.querySelector('.overview-table tbody');
  expect(table?.textContent).toContain('No request round-trip for push');
  expect(table?.textContent).toContain(
    'Push response; no request start expected',
  );
  view.click('Open request push from App instance 1');
  expect(view.shadow.querySelector('.request-outcome')?.textContent).toContain(
    'Push response push',
  );
  expect(view.shadow.querySelector('.content-pane')?.textContent).toContain(
    'Push source and outcome retained in the terminal event.',
  );
  expect(view.shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Push receipt and outcome retained.',
  );
  expect(view.shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'the request start is not retained',
  );
  expect(view.tools.capture.getSnapshot().count).toBe(0);
});

test.each([
  { actionFailures: '[REDACTED]', skippedActions: 1 },
  { actionFailures: 1, skippedActions: '[TRUNCATED]' },
])('partial terminal counters keep confirmed issues in the Overview and inspector: %j', (counters) => {
  const view = importEvents([
    event('applied', 'client.response.applied', counters, 'partial'),
  ]);
  view.click('Overview');
  view.select('Overview outcome', 'applied-with-issues');
  expect(view.shadow.querySelectorAll('.overview-table tbody tr')).toHaveLength(
    1,
  );
  expect(
    view.shadow.querySelector('.overview-table tbody')?.textContent,
  ).toContain('Applied with Action issues');
  view.click('Open request partial from App instance 1');
  expect(
    view.shadow.querySelector('.request-outcome .badge')?.textContent,
  ).toBe('Applied with Action issues');
  expect(
    view.shadow.querySelector('.request-outcome')?.textContent,
  ).not.toContain('Outcome unknown');
  expect(view.tools.capture.getSnapshot().count).toBe(0);
});

test('push coverage identifies a retained receipt when the recording includes one', () => {
  const view = importEvents([
    event('receipt', 'client.response.received', { source: 'push' }, 'push'),
    event('terminal', 'client.response.discarded', { source: 'push' }, 'push'),
  ]);
  expect(view.shadow.querySelector('.content-pane')?.textContent).toContain(
    'Push receipt and outcome retained.',
  );
  expect(view.shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Push source and outcome retained in the terminal event.',
  );
});

test('unknown request outcomes remain unknown after opening their evidence', () => {
  const view = importEvents([
    event('end', 'client.response.applied', { durationMs: 3 }, 'unknown'),
  ]);
  view.click('Overview');
  view.click('Open request unknown from App instance 1');
  expect(
    view.shadow.querySelector('.request-outcome .badge')?.textContent,
  ).toBe('Outcome unknown');
  expect(
    view.shadow.querySelector('.request-outcome')?.getAttribute('data-tone'),
  ).not.toBe('success');
  expect(
    view.shadow.querySelector('.request-card')?.textContent ??
      view.shadow.querySelector('.list-pane')?.textContent,
  ).toContain('Outcome unknown');
});

test('unknown producer results stay distinct from failures without blaming Action evidence', () => {
  const view = importEvents([
    event(
      'unknown',
      'client.request.failed',
      { outcome: 'unknown', durationMs: 9 },
      'uncertain',
    ),
    event(
      'failed',
      'client.request.failed',
      { outcome: 'failed', durationMs: 12 },
      'failed',
    ),
  ]);
  view.click('Overview');
  view.select('Overview outcome', 'unknown');
  expect(
    view.shadow.querySelector('.overview-table tbody')?.textContent,
  ).toContain('Outcome not established');
  expect(view.shadow.querySelectorAll('.overview-table tbody tr')).toHaveLength(
    1,
  );
  view.click('Open request uncertain from App instance 1');
  const outcome = view.shadow.querySelector('.request-outcome');
  expect(outcome?.textContent).toContain(
    'Retained evidence does not establish a final request outcome.',
  );
  expect(outcome?.textContent).not.toContain('Action outcome counts');
  expect(outcome?.textContent).not.toContain('The client reported a failure');
  view.click('Overview');
  view.select('Overview outcome', 'failed');
  expect(
    view.shadow.querySelector('.overview-table tbody')?.textContent,
  ).toContain('failed');
  expect(
    view.shadow.querySelector('.overview-table tbody')?.textContent,
  ).not.toContain('uncertain');
});

test.each([
  ['client.response.discarded', 'Discarded'],
  ['client.response.abandoned', 'Abandoned'],
])('Overview and Requests give %s the same warning presentation', (kind, label) => {
  const view = importEvents([event('end', kind, {}, 'attention')]);
  view.click('Overview');
  const legend = Array.from(
    view.shadow.querySelectorAll('.overview-outcomes span'),
  ).find((node) => node.textContent?.startsWith(label));
  expect(legend?.getAttribute('data-tone')).toBe('warning');
  view.click('Open request attention from App instance 1');
  expect(view.shadow.querySelector('.list-pane .badge')?.textContent).toBe(
    label,
  );
  expect(
    view.shadow.querySelector('.list-pane .badge')?.getAttribute('data-tone'),
  ).toBe('warning');
  expect(
    view.shadow.querySelector('.request-outcome')?.getAttribute('data-tone'),
  ).toBe('warning');
});

test('source round trips outside Overview reset its filters rather than reviving stale scope', () => {
  const view = importEvents([
    event('end', 'client.request.failed', {}, 'failed'),
  ]);
  view.click('Overview');
  view.select('Overview outcome', 'failed');
  view.click('Requests');
  view.select('Evidence source', 'live');
  view.select('Evidence source', 'imported');
  view.click('Overview');
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      'select[aria-label="Overview outcome"]',
    )?.value,
  ).toBe('all');
});

test('changing app scope keeps same-source Overview filters', () => {
  const view = importEvents([
    event('one', 'client.request.failed', {}, 'one'),
    event('two', 'client.request.started', { clientId: 'other' }, 'two'),
  ]);
  view.click('Overview');
  view.select('Overview outcome', 'failed');
  view.select('App instance', 'other');
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      'select[aria-label="Overview outcome"]',
    )?.value,
  ).toBe('failed');
  expect(view.shadow.querySelector('.overview-summary')?.textContent).toContain(
    '0 matching',
  );
});

test('ambiguous observations preserve keyboard focus and selected state after inspection', async () => {
  const view = importEvents([
    event('start', 'client.request.started', {}, 'duplicate'),
    event(
      'one',
      'client.response.applied',
      { actionFailures: 0, skippedActions: 0 },
      'duplicate',
    ),
    event('two', 'client.response.failed', {}, 'duplicate'),
  ]);
  const find = () =>
    Array.from(view.shadow.querySelectorAll('button')).find(
      (node) => node.textContent === 'Request sent',
    );
  find()?.focus();
  view.click('Request sent');
  await Promise.resolve();
  expect(view.shadow.activeElement).toBe(find() ?? null);
  expect(find()?.getAttribute('aria-pressed')).toBe('true');
});

test('capture-wide event loss cannot be described as known request loss', () => {
  const view = importEvents(
    [
      event('voice', 'voice.media'),
      event('start', 'client.request.started', {}, 'one'),
    ],
    5,
  );
  view.click('Overview');
  const text = view.shadow.querySelector('.request-overview')?.textContent;
  expect(text).toContain('Recording-event loss: 5 dropped or evicted');
  expect(text).toContain('Request-specific loss is not reported');
});
