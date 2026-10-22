import { expect, test } from 'bun:test';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { fireEvent, waitFor } from '@testing-library/react';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { event, mount, attach } = createVoicePanelHarness();

function recording(events: unknown[], droppedEvents = 0) {
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

test('planner evidence lets a developer inspect a rejected validation beside its JSON without calling it the final outcome', () => {
  const view = recording([
    event('start', 'client.request.started', {}, 'request'),
    event(
      'attempt',
      'engine.planner.attempt',
      { 'maelstrom.attempt': 0 },
      'request',
    ),
    event(
      'rejected',
      'engine.candidate.validated',
      { outcome: 'failed' },
      'request',
      { reason: 'invalid layout' },
    ),
    event(
      'valid',
      'engine.candidate.validated',
      { outcome: 'succeeded' },
      'request',
    ),
    event(
      'applied',
      'client.response.applied',
      { actionFailures: 0, skippedActions: 0 },
      'request',
    ),
  ]);
  const details = view.shadow.querySelector<HTMLDetailsElement>(
    'details[aria-label="Planner evidence"]',
  );
  expect(details).not.toBeNull();
  expect(details!.open).toBe(false);
  details!.open = true;
  expect(details!.textContent).toContain('Attempt 0 reported');
  expect(details!.textContent).toContain('Validation passed');
  expect(details!.textContent).toContain('do not establish attempt ownership');
  const rejected = [...details!.querySelectorAll('button')].find(
    (button) => button.textContent === 'Validation failed',
  )!;
  expect(rejected).toBeDefined();
  fireEvent.click(rejected);
  view.click('Raw JSON');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"id": "rejected"',
  );
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    'invalid layout',
  );
  expect(
    view.shadow.querySelector('.request-outcome .badge')?.textContent,
  ).toBe('Applied');
  expect(view.tools.capture.getSnapshot().count).toBe(0);
});

test('a model call report shows its source and reported zero usage while absent usage stays unknown', () => {
  const view = recording([
    event(
      'model',
      'engine.llm.call',
      {
        'gen_ai.request.model': 'model-a',
        'gen_ai.usage.input_tokens': 0,
        'maelstrom.latency_ms': 0,
        'maelstrom.outcome': 'ok',
      },
      'request',
      { 'gen_ai.usage.output_tokens': 999 },
    ),
  ]);
  const details = view.shadow.querySelector('[aria-label="Planner evidence"]')!;
  expect(details.textContent).toContain('Source: engine.llm.call');
  expect(details.textContent).toContain('Model: model-a');
  expect(details.textContent).toContain('Input tokens: 0');
  expect(details.textContent).toContain('Output tokens: Not reported');
  expect(details.textContent).toContain('Reported duration: 0 ms');
  expect(details.textContent).not.toContain('999');
  expect(details.textContent).toContain('internal provider calls');
});

test.each([
  0, 1,
])('reported attempt %s matches the producer number in the selected JSON', (attempt) => {
  const view = recording([
    event(
      'attempt',
      'engine.planner.attempt',
      { 'maelstrom.attempt': attempt },
      'request',
    ),
  ]);
  const row = view.shadow.querySelector(
    '[aria-label="Planner observations"] button',
  )!;
  expect(row.textContent).toBe(`Attempt ${attempt} reported`);
  fireEvent.click(row);
  view.click('Raw JSON');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    `"maelstrom.attempt": ${attempt}`,
  );
});

test('redacted attempt and validation facts remain explicit and do not appear as failed or accepted work', () => {
  const view = recording([
    event(
      'attempt',
      'engine.planner.attempt',
      { 'maelstrom.attempt': '[REDACTED]' },
      'request',
    ),
    event(
      'validation',
      'engine.candidate.validated',
      { outcome: '[TRUNCATED]' },
      'request',
    ),
  ]);
  const details = view.shadow.querySelector('[aria-label="Planner evidence"]')!;
  expect(details.textContent).toContain('Attempt number: Redacted');
  expect(details.textContent).toContain('Validation outcome: Truncated');
  expect(details.textContent).not.toContain('Validation failed');
  expect(details.textContent).not.toContain('Validation passed');
});

test('live planner updates preserve an open disclosure, selected evidence, focus, and scroll without starting capture', async () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  emit('client.request.started', {}, 'request');
  emit('engine.candidate.validated', { outcome: 'failed' }, 'request');
  const view = mount(tools);
  const details = () =>
    view.shadow.querySelector<HTMLDetailsElement>(
      '[aria-label="Planner evidence"]',
    )!;
  details().open = true;
  const rejected = details().querySelector('button')!;
  rejected.focus();
  expect(view.shadow.activeElement).toBe(rejected);
  const focusedKey = rejected.dataset.focusKey;
  expect(focusedKey).toStartWith('planner:');
  fireEvent.click(rejected);
  await waitFor(() =>
    expect((view.shadow.activeElement as HTMLElement)?.dataset.focusKey).toBe(
      focusedKey,
    ),
  );
  details().querySelector<HTMLElement>(
    '[aria-label="Planner observations"]',
  )!.scrollTop = 40;
  emit('engine.llm.call', { 'gen_ai.request.model': 'later-model' }, 'request');
  await waitFor(() =>
    expect((view.shadow.activeElement as HTMLElement)?.dataset.focusKey).toBe(
      focusedKey,
    ),
  );
  expect(details().open).toBe(true);
  expect(details().textContent).toContain('later-model');
  expect((view.shadow.activeElement as HTMLElement)?.dataset.focusKey).toBe(
    focusedKey,
  );
  expect(details().querySelector('[aria-pressed="true"]')?.textContent).toBe(
    'Validation failed',
  );
  expect(
    details().querySelector('[aria-label="Planner observations"]')?.scrollTop,
  ).toBe(40);
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('planner presentation bounds its rows while keeping every imported observation and its loss count intact', () => {
  const events = Array.from({ length: 70 }, (_, index) =>
    event(
      `model-${index}`,
      'engine.llm.call',
      {
        'gen_ai.request.model': `model-${index}`,
        'gen_ai.usage.input_tokens': index,
      },
      'request',
    ),
  );
  const view = recording(events, 7);
  const details = view.shadow.querySelector('[aria-label="Planner evidence"]')!;
  expect(
    details.querySelectorAll('[aria-label="Planner observations"] button'),
  ).toHaveLength(50);
  expect(details.textContent).toContain(
    'Showing 1–50 of 70 retained planner observations',
  );
  expect(details.textContent).toContain(
    'This view limit does not remove recorded events',
  );
  const imported = view.tools.getSnapshot().imported as {
    capture: { events: Array<{ id: string }>; droppedEvents: number };
  };
  expect(imported.capture.events).toHaveLength(70);
  expect(imported.capture.events.at(-1)?.id).toBe('model-69');
  expect(imported.capture.droppedEvents).toBe(7);
});

test('paging planner evidence reaches later calls and the final outcome without changing the recording or selected JSON', () => {
  const view = recording([
    ...Array.from({ length: 120 }, (_, index) =>
      event(
        `model-${index}`,
        'engine.llm.call',
        { 'gen_ai.request.model': `model-${index}` },
        'request',
      ),
    ),
    event(
      'final-planning-outcome',
      'engine.planner.completed',
      { outcome: 'succeeded' },
      'request',
    ),
  ]);
  const details = () =>
    view.shadow.querySelector<HTMLDetailsElement>(
      '[aria-label="Planner evidence"]',
    )!;
  const rows = () =>
    details().querySelector('[aria-label="Planner observations"]')!;
  details().open = true;
  view.click('Next planner observations');
  expect(details().open).toBe(true);
  expect(rows().querySelectorAll('button')).toHaveLength(50);
  expect(rows().textContent).toContain('Model: model-50');
  expect(rows().textContent).not.toContain('Model: model-0');
  view.click('Next planner observations');
  expect(rows().querySelectorAll('button')).toHaveLength(21);
  const outcome = [...rows().querySelectorAll('button')].find((row) =>
    row.textContent?.includes('Planning outcome · Succeeded'),
  )!;
  expect(outcome).toBeDefined();
  fireEvent.click(outcome);
  view.click('Raw JSON');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"id": "final-planning-outcome"',
  );
  view.click('Previous planner observations');
  expect(rows().querySelectorAll('button')).toHaveLength(50);
  expect(rows().textContent).toContain('Model: model-50');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"id": "final-planning-outcome"',
  );
  expect(
    (view.tools.getSnapshot().imported as { capture: { events: unknown[] } })
      .capture.events,
  ).toHaveLength(121);
  expect(view.tools.capture.getSnapshot().active).toBe(false);
});

test('later live observations preserve the planner page, selection, focus, and scroll', async () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  emit('client.request.started', {}, 'request');
  for (let index = 0; index < 70; index++)
    emit(
      'engine.llm.call',
      { 'gen_ai.request.model': `model-${index}` },
      'request',
    );
  const view = mount(tools);
  const details = () =>
    view.shadow.querySelector<HTMLDetailsElement>(
      '[aria-label="Planner evidence"]',
    )!;
  const rows = () =>
    details().querySelector<HTMLElement>(
      '[aria-label="Planner observations"]',
    )!;
  details().open = true;
  view.click('Next planner observations');
  const selected = rows().querySelector('button')!;
  selected.focus();
  const focusKey = selected.dataset.focusKey;
  fireEvent.click(selected);
  await waitFor(() =>
    expect((view.shadow.activeElement as HTMLElement)?.dataset.focusKey).toBe(
      focusKey,
    ),
  );
  rows().scrollTop = 80;
  emit('engine.planner.completed', { outcome: 'succeeded' }, 'request');
  await waitFor(() =>
    expect((view.shadow.activeElement as HTMLElement)?.dataset.focusKey).toBe(
      focusKey,
    ),
  );
  expect(details().open).toBe(true);
  expect(details().textContent).toContain('Showing 51–71 of 71');
  expect(rows().querySelectorAll('button')).toHaveLength(21);
  expect(rows().querySelector('[aria-pressed="true"]')?.textContent).toContain(
    'Model: model-50',
  );
  expect(rows().scrollTop).toBe(80);
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('a retained planner selection keeps keyboard focus when eviction moves its row to another page', async () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxRequestEvents: 51,
    maxActivityEvents: 1,
  });
  const emit = attach(tools);
  for (let index = 0; index < 51; index++)
    emit(
      'engine.llm.call',
      { 'gen_ai.request.model': `model-${index}` },
      'request',
    );
  const view = mount(tools);
  const details = () =>
    view.shadow.querySelector<HTMLDetailsElement>(
      '[aria-label="Planner evidence"]',
    )!;
  details().open = true;
  view.click('Next planner observations');
  view.click('Raw JSON');
  const selected = details().querySelector<HTMLButtonElement>(
    '[aria-label="Planner observations"] button',
  )!;
  expect(selected.textContent).toContain('Model: model-50');
  selected.focus();
  fireEvent.click(selected);
  await waitFor(() => expect(view.shadow.activeElement).not.toBeNull());
  emit('engine.llm.call', { 'gen_ai.request.model': 'model-51' }, 'request');
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(view.shadow.activeElement).not.toBeNull();
  expect(view.shadow.activeElement).toBe(
    view.shadow.querySelector('[aria-label="Request details"]'),
  );
  expect(details().textContent).toContain('Showing 51–51 of 51');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    'model-50',
  );
  expect(selected.isConnected).toBe(false);
});

test.each([
  'Previous',
  'Next',
] as const)('a disappearing %s planner page control returns keyboard focus to the request', async (direction) => {
  const tools = createDevtools({ initialIsOpen: true, maxRequestEvents: 51 });
  const emit = attach(tools);
  for (let index = 0; index < 51; index++)
    emit(
      'engine.llm.call',
      { 'gen_ai.request.model': `model-${index}` },
      'request',
    );
  const view = mount(tools);
  view.shadow.querySelector<HTMLDetailsElement>(
    '[aria-label="Planner evidence"]',
  )!.open = true;
  view.click('Next planner observations');
  const control = [...view.shadow.querySelectorAll('button')].find(
    (button) => button.textContent === `${direction} planner observations`,
  )!;
  control.focus();
  emit('engine.stage.completed', { stage: 'layout' }, 'request');
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(view.shadow.activeElement).not.toBeNull();
  expect(view.shadow.activeElement).toBe(
    view.shadow.querySelector('[aria-label="Request details"]'),
  );
  expect(control.isConnected).toBe(false);
  expect(
    view.shadow.querySelectorAll('[aria-label="Planner observations"] button'),
  ).toHaveLength(50);
});

test.each([
  'A',
  'B',
] as const)('comparison %s keeps focus in its own request when retention moves the selected planner row', async (side) => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxRequestEvents: 52,
    maxActivityEvents: 1,
  });
  const emit = attach(tools);
  emit('engine.llm.call', { 'gen_ai.request.model': 'other-model' }, 'other');
  for (let index = 0; index < 51; index++)
    emit(
      'engine.llm.call',
      { 'gen_ai.request.model': `active-model-${index}` },
      'active',
    );
  const view = mount(tools);
  const selectRequest = (requestId: string) =>
    fireEvent.click(
      [...view.shadow.querySelectorAll('.list-pane button')].find((button) =>
        button.textContent?.includes(`Request ${requestId}`),
      )!,
    );
  if (side === 'B') selectRequest('other');
  view.click('Compare request');
  selectRequest(side === 'A' ? 'other' : 'active');
  const request = () =>
    view.shadow.querySelector<HTMLElement>(
      `[aria-label="${side} request details"]`,
    )!;
  const planner = request().querySelector<HTMLDetailsElement>(
    '[aria-label="Planner evidence"]',
  )!;
  planner.open = true;
  view.click('Next planner observations');
  view.click(`${side} event JSON: Raw JSON`);
  const selected = request().querySelector<HTMLButtonElement>(
    '[aria-label="Planner observations"] button',
  )!;
  selected.focus();
  fireEvent.click(selected);
  await waitFor(() => expect(view.shadow.activeElement).not.toBeNull());
  emit(
    'engine.llm.call',
    { 'gen_ai.request.model': 'active-model-51' },
    'active',
  );
  emit(
    'engine.llm.call',
    { 'gen_ai.request.model': 'active-model-52' },
    'active',
  );
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(view.shadow.activeElement).not.toBeNull();
  expect(view.shadow.activeElement).toBe(request());
  expect(request().textContent).toContain('Showing 51–52 of 52');
  expect(
    view.shadow.querySelector(`[aria-label="${side} event JSON"] .json-raw`)
      ?.textContent,
  ).toContain('active-model-50');
});

test('comparison columns retain independent planner pages and inherit the initial request page', () => {
  const view = recording(
    ['a', 'b'].flatMap((requestId) => [
      event(`${requestId}-start`, 'client.request.started', {}, requestId),
      ...Array.from({ length: 70 }, (_, index) =>
        event(
          `${requestId}-model-${index}`,
          'engine.llm.call',
          { 'gen_ai.request.model': `${requestId}-model-${index}` },
          requestId,
        ),
      ),
    ]),
  );
  view.click('Next planner observations');
  view.click('Compare request');
  fireEvent.click(
    [...view.shadow.querySelectorAll('.list-pane button')].find((button) =>
      button.textContent?.includes('Request a'),
    )!,
  );
  const side = (name: 'A' | 'B') =>
    view.shadow.querySelector(`[aria-label="Comparison ${name}"]`)!;
  const rows = (name: 'A' | 'B') =>
    side(name).querySelector('[aria-label="Planner observations"]')!;
  const clickPage = (name: 'A' | 'B', label: string) =>
    fireEvent.click(
      [...side(name).querySelectorAll('button')].find(
        (button) => button.textContent === label,
      )!,
    );
  expect(rows('A').textContent).toContain('Model: b-model-50');
  expect(rows('B').textContent).toContain('Model: a-model-0');
  clickPage('B', 'Next planner observations');
  fireEvent.click(rows('B').querySelector('button')!);
  view.click('B event JSON: Raw JSON');
  clickPage('A', 'Previous planner observations');
  expect(rows('A').textContent).toContain('Model: b-model-0');
  expect(rows('B').textContent).toContain('Model: a-model-50');
  expect(
    rows('B').querySelector('[aria-pressed="true"]')?.textContent,
  ).toContain('Model: a-model-50');
  expect(side('B').querySelector('.json-raw')?.textContent).toContain(
    '"id": "a-model-50"',
  );
});

test('each comparison column selects planner evidence into its own JSON inspector', () => {
  const view = recording([
    event('a-start', 'client.request.started', {}, 'a'),
    event(
      'reused-report',
      'engine.candidate.validated',
      { outcome: 'failed' },
      'a',
      { marker: 'report-a' },
    ),
    event('b-start', 'client.request.started', {}, 'b'),
    event(
      'reused-report',
      'engine.candidate.validated',
      { outcome: 'succeeded' },
      'b',
      { marker: 'report-b' },
    ),
  ]);
  view.click('Compare request');
  fireEvent.click(
    [...view.shadow.querySelectorAll('.list-pane button')].find((button) =>
      button.textContent?.includes('Request a'),
    )!,
  );
  const side = (name: 'A' | 'B') =>
    view.shadow.querySelector(`[aria-label="Comparison ${name}"]`)!;
  for (const name of ['A', 'B'] as const) {
    const details = side(name).querySelector<HTMLDetailsElement>(
      '[aria-label="Planner evidence"]',
    )!;
    details.open = true;
    fireEvent.click(details.querySelector('button')!);
  }
  view.click('A event JSON: Raw JSON');
  view.click('B event JSON: Raw JSON');
  expect(side('A').querySelector('.json-raw')?.textContent).toContain(
    'report-b',
  );
  expect(side('B').querySelector('.json-raw')?.textContent).toContain(
    'report-a',
  );
  for (const name of ['A', 'B'] as const) {
    const details = side(name).querySelector<HTMLDetailsElement>(
      '[aria-label="Planner evidence"]',
    )!;
    expect(details.open).toBe(true);
    expect(details.querySelector('button')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  }
});

test('missing planner evidence gives setup guidance and ambiguous request evidence cannot imply planner summaries', () => {
  const view = recording([
    event('start', 'client.request.started', {}, 'request'),
  ]);
  expect(
    view.shadow.querySelector('[aria-label="Planner evidence"]')?.textContent,
  ).toContain('No planner observations are retained');
  expect(view.tools.capture.getSnapshot().active).toBe(false);
  view.tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('first', 'client.request.started', {}, 'request'),
          event(
            'attempt',
            'engine.planner.attempt',
            { 'maelstrom.attempt': 0 },
            'request',
          ),
          event('reused-start', 'client.request.started', {}, 'request'),
        ],
      },
    }),
  );
  expect(
    view.shadow.querySelector('[aria-label="Planner evidence"]'),
  ).toBeNull();
  expect(view.shadow.textContent).toContain('Ambiguous request evidence');
});

test('a cancelled planning outcome stays distinct from a failed attempt in planner evidence', () => {
  const view = recording([
    event(
      'cancelled',
      'engine.planner.failed',
      { outcome: 'cancelled', durationMs: 12 },
      'request',
    ),
  ]);
  const details = view.shadow.querySelector('[aria-label="Planner evidence"]')!;
  expect(details.textContent).toContain('Planning outcome · Cancelled');
  expect(details.textContent).toContain('Reported duration: 12 ms');
  expect(details.textContent).not.toContain('Planning failed');
});

test.each([
  ['engine.planner.failed', '[REDACTED]', 'Redacted'],
  ['engine.planner.completed', '[TRUNCATED]', 'Truncated'],
  ['engine.planner.failed', undefined, 'Not reported'],
  ['engine.planner.completed', 'unsupported', 'Invalid or unavailable'],
  ['engine.planner.completed', 'unreported', 'Invalid or unavailable'],
] as const)('planner outcome %s preserves unavailable %s without inventing failure or success', (kind, outcome, expected) => {
  const view = recording([event('outcome', kind, { outcome }, 'request')]);
  const details = view.shadow.querySelector('[aria-label="Planner evidence"]')!;
  expect(details.textContent).toContain(`Planning outcome · ${expected}`);
  expect(details.textContent).not.toContain('Planning outcome · Failed');
  expect(details.textContent).not.toContain('Planning outcome · Succeeded');
});

test('inspecting a stopped recording preserves every exported event and never starts a second recording', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  tools.startCapture();
  emit('client.request.started', {}, 'request');
  emit(
    'engine.llm.call',
    {
      'gen_ai.request.model': 'recorded-model',
      'gen_ai.usage.output_tokens': 0,
    },
    'request',
  );
  tools.stopCapture();
  const original = JSON.parse(tools.exportCapture());
  const view = mount(tools);
  view.select('Evidence source', 'recording');
  const details = view.shadow.querySelector<HTMLDetailsElement>(
    '[aria-label="Planner evidence"]',
  )!;
  expect(details.textContent).toContain('Model: recorded-model');
  expect(details.textContent).toContain('Output tokens: 0');
  details.open = true;
  fireEvent.click(details.querySelector('button')!);
  view.click('Raw JSON');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    'recorded-model',
  );
  expect(JSON.parse(tools.exportCapture()).capture.events).toEqual(
    original.capture.events,
  );
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('empty planner guidance stays available for one request without taking comparison space from retained phases', () => {
  const view = recording([
    event(
      'a-stage',
      'engine.stage.completed',
      { stage: 'layout', durationMs: 4 },
      'a',
    ),
    event(
      'b-stage',
      'engine.stage.completed',
      { stage: 'layout', durationMs: 8 },
      'b',
    ),
  ]);
  expect(
    view.shadow.querySelector<HTMLDetailsElement>(
      '[aria-label="Planner evidence"]',
    )?.hidden,
  ).toBe(false);
  view.click('Compare request');
  fireEvent.click(
    [...view.shadow.querySelectorAll('.list-pane button')].find((button) =>
      button.textContent?.includes('Request a'),
    )!,
  );
  const sections = view.shadow.querySelectorAll<HTMLDetailsElement>(
    '[aria-label="Planner evidence"]',
  );
  expect(sections).toHaveLength(2);
  for (const section of sections) expect(section.hidden).toBe(true);
  view.click('Exit comparison');
  expect(
    view.shadow.querySelector<HTMLDetailsElement>(
      '[aria-label="Planner evidence"]',
    )?.hidden,
  ).toBe(false);
});
