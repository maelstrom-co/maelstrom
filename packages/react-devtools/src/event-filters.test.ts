import { expect, test } from 'bun:test';
import { Orchestrator } from '@maelstrom-co/client';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { fireEvent } from '@testing-library/react';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { event, mount, attach, cleanups } = createVoicePanelHarness();
function imported(events: unknown[]) {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({ schemaVersion: 2, capture: { schemaVersion: 1, events } }),
  );
  const view = mount(tools);
  view.select('Evidence source', 'imported');
  view.select('Activity view', 'events');
  return { tools, ...view };
}

test('Voice preset isolates metadata and reports hidden events without starting a recording', () => {
  const view = imported([
    event('start', 'client.request.started', {}, 'request'),
    event('voice', 'voice.tool.result', { outcome: 'succeeded' }),
    event('connection', 'client.connection.failed'),
  ]);
  view.select('Event preset', 'voice');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  expect(view.shadow.querySelector('.toolbar')?.textContent).toContain(
    '1 matching',
  );
  expect(view.shadow.querySelector('.toolbar')?.textContent).toContain(
    '2 hidden by filters',
  );
  expect(view.tools.capture.getSnapshot().count).toBe(0);
  view.click('Reset event filters');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(3);
});

test('preset criteria remain editable and combine family, exact kind, and reported event outcome', () => {
  const view = imported([
    event('failed', 'voice.tool.result', { ok: false, outcome: 'failed' }),
    event('success', 'voice.tool.result', { ok: true, outcome: 'succeeded' }),
    event('started', 'voice.tool.called'),
    event('engine', 'engine.stage.failed'),
  ]);
  view.select('Event preset', 'voice');
  view.select('Event outcome', 'failed');
  view.select('Event kind', 'voice.tool.result');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  expect(
    view.shadow.querySelector<HTMLSelectElement>('[aria-label="Event preset"]')
      ?.value,
  ).toBe('custom');
  view.select('Event family', 'engine');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(0);
  view.select('Event kind', '');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
});

test('successful Engine validations remain discoverable through the reported outcome selector', () => {
  const view = imported([
    event('accepted', 'engine.candidate.validated', { outcome: 'succeeded' }),
    event('rejected', 'engine.candidate.validated', { outcome: 'failed' }),
    event('missing', 'engine.candidate.validated'),
  ]);
  view.select('Event preset', 'engine');
  view.select('Event outcome', 'succeeded');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  view.click('Raw JSON');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"id": "accepted"',
  );
  view.select('Event outcome', 'unreported');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"id": "missing"',
  );
});

test.each([
  false,
  true,
])('Clear releases obsolete request and voice criteria so new events remain visible (remounted: %s)', (remounted) => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  emit('voice.tool.result', { ok: false, outcome: 'failed' }, 'before-clear');
  let view = mount(tools);
  view.select('Activity view', 'events');
  view.select('Event preset', 'voice');
  view.select('Event outcome', 'failed');
  view.select('Issue category', 'unreported');
  for (const label of ['Request filter', 'Voice connection filter']) {
    const select = view.shadow.querySelector<HTMLSelectElement>(
      `[aria-label="${label}"]`,
    )!;
    view.select(label, select.options[1].value);
  }
  fireEvent.input(
    view.shadow.querySelector('[aria-label="Filter diagnostic evidence"]')!,
    { target: { value: 'before-clear' } },
  );
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  if (remounted) view.unmount();
  tools.clear();
  emit(
    'voice.tool.result',
    { generation: 2, ok: true, outcome: 'succeeded' },
    'after-clear',
  );
  if (remounted) view = mount(tools);
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      '[aria-label="Request filter"]',
    )?.value,
  ).toBe('');
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      '[aria-label="Voice connection filter"]',
    )?.value,
  ).toBe('');
  expect(
    view.shadow.querySelector<HTMLSelectElement>('[aria-label="Event preset"]')
      ?.value,
  ).toBe('all');
  expect(
    view.shadow.querySelector<HTMLInputElement>(
      '[aria-label="Filter diagnostic evidence"]',
    )?.value,
  ).toBe('');
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      '[aria-label="Issue category"]',
    )?.value,
  ).toBe('all');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
});

test('ordinary retention and recording-only resets keep a live target explicit instead of broadening the view', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 1 });
  const emit = attach(tools);
  emit('voice.tool.called', {}, 'selected');
  const view = mount(tools);
  view.select('Activity view', 'events');
  view.select('Event preset', 'voice');
  const request = view.shadow.querySelector<HTMLSelectElement>(
    '[aria-label="Request filter"]',
  )!;
  const selected = request.options[1].value;
  view.select('Request filter', selected);
  tools.capture.clear();
  expect(request.value).toBe(selected);
  emit('voice.tool.called', { generation: 2 }, 'other');
  expect(request.value).toBe(selected);
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(0);
  expect(request.selectedOptions[0]?.textContent).toContain(
    'no longer retained',
  );
});

test('composed filters inspect a stopped recording without removing events from its export', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  tools.startCapture();
  emit('voice.tool.result', { ok: true, outcome: 'succeeded' }, 'success');
  emit('voice.tool.result', { ok: false, outcome: 'failed' }, 'failure');
  tools.stopCapture();
  const recorded = JSON.parse(tools.exportCapture()).capture.events;
  const view = mount(tools);
  view.select('Evidence source', 'recording');
  view.select('Activity view', 'events');
  view.select('Event preset', 'voice');
  view.select('Event outcome', 'succeeded');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  expect(view.shadow.querySelector('.toolbar')?.textContent).toContain(
    '1 matching',
  );
  expect(JSON.parse(tools.exportCapture()).capture.events).toEqual(recorded);
});

test('readable request and voice connection choices do not combine reused identities across apps or scopes', () => {
  const view = imported([
    event('a', 'voice.tool.called', { clientId: 'app-a' }, 'shared'),
    event('b', 'voice.tool.called', { clientId: 'app-b' }, 'shared'),
    event(
      'next',
      'voice.tool.called',
      { clientId: 'app-a', generation: 2 },
      'shared',
    ),
    event(
      'native',
      'voice.tool.called',
      { clientId: 'app-a', providerGeneration: 1 },
      'shared',
    ),
  ]);
  const request = view.shadow.querySelector<HTMLSelectElement>(
    '[aria-label="Request filter"]',
  );
  const requestChoice = Array.from(request?.options ?? []).find(
    (option) => option.textContent === 'App instance 1 · Request shared',
  );
  expect(requestChoice).toBeDefined();
  view.select('Request filter', requestChoice!.value);
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(3);
  const voice = view.shadow.querySelector<HTMLSelectElement>(
    '[aria-label="Voice connection filter"]',
  );
  const voiceChoice = Array.from(voice?.options ?? []).find(
    (option) =>
      option.textContent?.includes('App instance 1') &&
      option.textContent.includes('session generation 1'),
  );
  expect(voiceChoice).toBeDefined();
  view.select('Voice connection filter', voiceChoice!.value);
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  view.click('Raw JSON');
  expect(view.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"id": "a"',
  );
});

test('time filters preserve missing timestamps and reject reversed ranges instead of broadening the view', () => {
  const from = '2026-10-21T10:00';
  const until = '2026-10-21T10:01';
  const view = imported([
    { ...event('first', 'app.event'), at: new Date(from).getTime() },
    { ...event('last', 'app.event'), at: new Date(until).getTime() },
    { ...event('later', 'app.event'), at: new Date(until).getTime() + 1 },
    { ...event('untimed', 'app.event'), at: undefined },
  ]);
  const start = view.shadow.querySelector<HTMLInputElement>(
    '[aria-label="From reported time"]',
  );
  const end = view.shadow.querySelector<HTMLInputElement>(
    '[aria-label="Until reported time"]',
  );
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  fireEvent.change(start!, { target: { value: from } });
  fireEvent.change(end!, { target: { value: until } });
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(2);
  fireEvent.change(start!, { target: { value: '2026-10-21T10:02' } });
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(0);
  expect(
    view.shadow.querySelector('.event-filter-error')?.textContent,
  ).toContain('The start must be before or equal to the end.');
  expect(start?.getAttribute('aria-invalid')).toBe('true');
  view.click('Reset event filters');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(4);
});

test('live updates preserve focused filter controls and a replaced import resets source-specific choices', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  emit('voice.tool.called');
  const view = mount(tools);
  view.select('Activity view', 'events');
  view.select('Event preset', 'voice');
  const kind = view.shadow.querySelector<HTMLSelectElement>(
    '[aria-label="Event kind"]',
  )!;
  kind.focus();
  view.select('Event kind', 'voice.tool.called');
  emit('voice.tool.called');
  expect(view.shadow.querySelector('[aria-label="Event kind"]')).toBe(kind);
  expect(view.shadow.activeElement).toBe(kind);
  expect(kind.value).toBe('voice.tool.called');
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [event('import', 'client.connection.failed')],
      },
    }),
  );
  view.select('Evidence source', 'imported');
  expect(
    view.shadow.querySelector<HTMLSelectElement>('[aria-label="Event preset"]')
      ?.value,
  ).toBe('all');
  view.select('Event preset', 'failures');
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [event('replacement', 'voice.tool.called')],
      },
    }),
  );
  expect(
    view.shadow.querySelector<HTMLSelectElement>('[aria-label="Event preset"]')
      ?.value,
  ).toBe('all');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  expect(tools.capture.getSnapshot().count).toBe(0);
});

test('view filters leave an active recording intact and grouped request summaries use unfiltered evidence', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  tools.startCapture();
  const baselineCount = tools.capture.getSnapshot().count;
  emit('client.request.started', {}, 'request');
  emit('voice.tool.result', { ok: false, outcome: 'failed' }, 'request');
  emit(
    'client.response.received',
    { source: 'request', durationMs: 10 },
    'request',
  );
  emit(
    'client.response.applied',
    { actionFailures: 0, skippedActions: 0, durationMs: 2 },
    'request',
  );
  const view = mount(tools);
  view.select('Activity view', 'events');
  view.select('Event preset', 'failures');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  expect(tools.capture.getSnapshot()).toMatchObject({
    active: true,
    count: baselineCount + 4,
  });
  emit('client.connection.changed');
  expect(tools.capture.getSnapshot().count).toBe(baselineCount + 5);
  view.select('Activity view', 'requests');
  expect(
    view.shadow.querySelector('.request-outcome .badge')?.textContent,
  ).toBe('Applied');
  expect(view.shadow.querySelector('.request-phases')?.textContent).toContain(
    'Request sent',
  );
  tools.stopCapture();
  const exported = JSON.parse(tools.exportCapture());
  expect(
    exported.capture.events.map((entry: { kind: string }) => entry.kind),
  ).toEqual(
    expect.arrayContaining([
      'client.request.started',
      'voice.tool.result',
      'client.response.received',
      'client.response.applied',
      'client.connection.changed',
    ]),
  );
});

test('pagination hides additional matches without counting them as filtered or lost', () => {
  const view = imported([
    ...Array.from({ length: 60 }, (_, index) =>
      event(`voice-${index}`, 'voice.tool.called'),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      event(`connection-${index}`, 'client.connection.failed'),
    ),
  ]);
  view.select('Event preset', 'voice');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(50);
  expect(view.shadow.querySelector('.toolbar')?.textContent).toContain(
    '60 matching · 5 hidden by filters',
  );
  view.click('Show more events');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(60);
});

test('app selection adds a criterion without clearing the selected event preset', () => {
  const view = imported([
    event('voice-a', 'voice.tool.called', { clientId: 'app-a' }),
    event('connection-a', 'client.connection.failed', { clientId: 'app-a' }),
    event('voice-b', 'voice.tool.called', { clientId: 'app-b' }),
  ]);
  view.select('Event preset', 'voice');
  view.select('App instance', 'app-a');
  expect(
    view.shadow.querySelector<HTMLSelectElement>('[aria-label="Event preset"]')
      ?.value,
  ).toBe('voice');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  expect(view.shadow.querySelector('.toolbar')?.textContent).toContain(
    '1 matching · 2 hidden by filters',
  );
});

test.each([
  undefined,
  '2026-10-21T09:00',
])('live evidence preserves a focused draft time edit from %s until commit or source reset', (initial) => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  emit('voice.tool.called');
  const view = mount(tools);
  view.select('Activity view', 'events');
  const details =
    view.shadow.querySelector<HTMLDetailsElement>('.event-filters')!;
  details.open = true;
  const input = view.shadow.querySelector<HTMLInputElement>(
    '[aria-label="From reported time"]',
  )!;
  if (initial) fireEvent.change(input, { target: { value: initial } });
  input.focus();
  fireEvent.input(input, { target: { value: '2026-10-21T10:00' } });
  emit('voice.tool.called');
  expect(input.value).toBe('2026-10-21T10:00');
  expect(view.shadow.activeElement).toBe(input);
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [event('new', 'voice.tool.called')],
      },
    }),
  );
  view.select('Evidence source', 'imported');
  expect(input.value).toBe('');
});

test('changing app scope resets event pagination while retaining matching and hidden counts', () => {
  const view = imported([
    ...Array.from({ length: 52 }, (_, index) =>
      event(`a-${index}`, 'voice.tool.called', { clientId: 'app-a' }),
    ),
    event('b', 'voice.tool.called', { clientId: 'app-b' }),
  ]);
  view.select('Event preset', 'voice');
  view.click('Show more events');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(53);
  view.select('App instance', 'app-a');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(50);
  expect(view.shadow.querySelector('.toolbar')?.textContent).toContain(
    '52 matching · 1 hidden by filters',
  );
});

test('replacing an import clears search and issue criteria together with advanced filters', () => {
  const view = imported([event('before', 'client.connection.failed')]);
  const search = view.shadow.querySelector<HTMLInputElement>(
    '[aria-label="Filter diagnostic evidence"]',
  )!;
  fireEvent.input(search, { target: { value: 'before' } });
  view.select('Issue category', 'provider');
  view.tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [event('after', 'voice.tool.called')],
      },
    }),
  );
  expect(search.value).toBe('');
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      '[aria-label="Issue category"]',
    )?.value,
  ).toBe('all');
  expect(
    view.shadow.querySelector<HTMLSelectElement>('[aria-label="Event preset"]')
      ?.value,
  ).toBe('all');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
});

test('an evicted selected app remains explicit and never broadens the query to another app', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxSessions: 2,
    maxActivityEvents: 1,
  });
  const first = new Orchestrator({
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    subscribe: () => () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
    process: async () => {
      throw new Error('No application work expected');
    },
  });
  const release = tools.attach(first);
  cleanups.push(() => {
    void first.dispose();
  }, release);
  const id = tools.getSnapshot().sessions[0].id;
  first.diagnostics.emitDiagnostic('voice.tool.called', {
    providerInstanceId: 'a',
    generationScope: 'session',
    generation: 1,
  });
  const emitOther = attach(tools);
  const view = mount(tools);
  view.select('Activity view', 'events');
  view.select('Event preset', 'voice');
  view.select('App instance', id);
  release();
  attach(tools);
  emitOther('voice.tool.called');
  const scope = view.shadow.querySelector<HTMLSelectElement>(
    '[aria-label="App instance"]',
  )!;
  expect(scope.value).toBe(id);
  expect(scope.selectedOptions[0].textContent).toBe(
    'App instance 1 · app state not retained',
  );
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(0);
  view.select('App instance', 'all');
  expect(
    view.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
});

test('Reset clears an uncommitted time draft even when no criteria are active', () => {
  const view = imported([event('one', 'voice.tool.called')]);
  view.shadow.querySelector<HTMLDetailsElement>('.event-filters')!.open = true;
  const input = view.shadow.querySelector<HTMLInputElement>(
    '[aria-label="From reported time"]',
  )!;
  input.focus();
  fireEvent.input(input, { target: { value: '2026-10-21T10:00' } });
  const reset = view.shadow.querySelector<HTMLButtonElement>(
    '[aria-label="Reset event filters"]',
  )!;
  expect(reset.disabled).toBe(false);
  view.click('Reset event filters');
  expect(input.value).toBe('');
});

test('remount preserves filters for the same import but resets them if the import changed while unmounted', () => {
  const first = imported([
    event('before', 'voice.tool.result', {
      ok: false,
      outcome: 'failed',
      tool: 'before',
    }),
  ]);
  first.select('Event preset', 'voice');
  first.select('Issue category', 'unreported');
  const input = first.shadow.querySelector<HTMLInputElement>(
    '[aria-label="Filter diagnostic evidence"]',
  )!;
  fireEvent.input(input, { target: { value: 'before' } });
  first.select('App instance', 'app');
  first.unmount();
  const same = mount(first.tools);
  expect(
    same.shadow.querySelector<HTMLInputElement>(
      '[aria-label="Filter diagnostic evidence"]',
    )?.value,
  ).toBe('before');
  expect(
    same.shadow.querySelectorAll('.list-pane button[data-focus-key^="event:"]'),
  ).toHaveLength(1);
  same.unmount();
  first.tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('after', 'client.connection.changed', { clientId: 'app-b' }),
        ],
      },
    }),
  );
  const replaced = mount(first.tools);
  expect(
    replaced.shadow.querySelector<HTMLInputElement>(
      '[aria-label="Filter diagnostic evidence"]',
    )?.value,
  ).toBe('');
  expect(
    replaced.shadow.querySelector<HTMLSelectElement>(
      '[aria-label="Issue category"]',
    )?.value,
  ).toBe('all');
  expect(
    replaced.shadow.querySelector<HTMLSelectElement>(
      '[aria-label="App instance"]',
    )?.value,
  ).toBe('all');
  expect(
    replaced.shadow.querySelector<HTMLSelectElement>(
      '[aria-label="Event preset"]',
    )?.value,
  ).toBe('all');
  expect(
    replaced.shadow.querySelectorAll(
      '.list-pane button[data-focus-key^="event:"]',
    ),
  ).toHaveLength(1);
});
