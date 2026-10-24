import { expect, test } from 'bun:test';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { event, attach, mount } = createVoicePanelHarness();

test('retained terminal voice observations agree with Connections without crossing app or evidence sources', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 1 });
  const emitA = attach(tools);
  const emitB = attach(tools);
  const [a, b] = tools.getSnapshot().sessions;
  if (!a || !b) throw new Error('Expected two attached app instances');
  emitA('voice.transport', {
    state: 'closed',
    provider: 'fixture',
    providerInstanceId: 'retained-provider',
    providerGeneration: 1,
  });
  emitB('app.event');
  tools.startCapture();
  tools.stopCapture();
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        droppedEvents: 0,
        events: [
          event(
            'saved',
            'client.request.started',
            { clientId: a.id },
            'saved-request',
          ),
        ],
      },
    }),
  );
  const view = mount(tools);
  view.click('Connections');
  view.click('Evidence & setup');
  const voice = () =>
    view.shadow.querySelector('[data-guidance="voice"] h3')?.textContent;
  expect(view.shadow.querySelector('.connections-grid')?.textContent).toContain(
    'Fixture',
  );
  expect(view.shadow.querySelector('.connections-grid')?.textContent).toContain(
    'closed',
  );
  expect(voice()).toBe('Voice events retained');
  view.select('App instance', b.id);
  expect(voice()).toBe('No voice events in the viewer window');
  view.select('App instance', a.id);
  expect(voice()).toBe('Voice events retained');
  for (const source of ['recording', 'imported']) {
    view.select('Evidence source', source);
    expect(voice()).toBe('No voice events in the viewer window');
  }
  view.select('Evidence source', 'live');
  expect(voice()).toBe('Voice events retained');
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('an imported app snapshot outside the viewer window is not described as lost from the recording', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    capture: { maxEvents: 10_001 },
  });
  const baseline = event(
    'baseline',
    'client.attached',
    { clientId: 'recorded-app' },
    undefined,
    {
      snapshot: { connection: 'connected', instances: [] },
    },
  );
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        droppedEvents: 0,
        events: [
          baseline,
          ...Array.from({ length: 10_000 }, (_, index) => ({
            kind: 'app.event',
            index,
          })),
        ],
      },
    }),
  );
  const recording = tools.getSnapshot().imported as {
    capture: { events: unknown[] };
  };
  expect(recording.capture.events).toHaveLength(10_001);
  expect(recording.capture.events[0]).toMatchObject({
    content: baseline.content,
  });
  const view = mount(tools);
  view.select('Evidence source', 'imported');
  expect(
    view.shadow.querySelector('[data-guidance="attachment"] h3')?.textContent,
  ).toBe('No app state in the viewer window');
  expect(
    view.shadow.querySelector('[data-guidance="recent-view"]')?.textContent,
  ).toContain('1 recorded event omitted by the viewer');
});

test('setup guidance is available across evidence tabs without starting capture or hiding the workspace', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  let inspections = 0;
  const inspect = tools.inspect.bind(tools);
  tools.inspect = (id) => {
    inspections++;
    return inspect(id);
  };
  const view = mount(tools);
  const guidance = view.shadow.querySelector<HTMLElement>(
    '[aria-label="Evidence and setup details"]',
  );
  expect(guidance).not.toBeNull();
  expect(guidance?.hidden).toBe(true);
  expect(guidance?.textContent).toContain(
    'No server events in the viewer window',
  );
  expect(guidance?.textContent).toContain(
    'Live activity contains metadata only',
  );
  view.click('Evidence & setup');
  for (const tab of [
    'Overview',
    'Recordings',
    'Connections',
    'Voice',
    'Requests',
  ]) {
    view.click(tab);
    expect(guidance?.hidden).toBe(false);
  }
  emit('engine.planner.started', {}, 'request');
  expect(guidance?.textContent).toContain('Server events retained');
  expect(guidance?.hidden).toBe(false);
  expect(tools.capture.getSnapshot()).toMatchObject({
    active: false,
    count: 0,
  });
  expect(inspections).toBe(0);
  view.click('Telemetry');
  expect(guidance?.hidden).toBe(true);
});

test('view filters explain hidden events without erasing retained setup observations, and imports stay independent of live settings', () => {
  const tools = createDevtools({ initialIsOpen: true, filter: () => true });
  attach(tools)('voice.transport');
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        droppedEvents: 0,
        events: [
          event(
            'server',
            'engine.planner.started',
            { clientId: 'app-a' },
            'request',
          ),
          event('voice', 'voice.transport', { clientId: 'app-b' }),
        ],
      },
    }),
  );
  const view = mount(tools);
  const guidance = view.shadow.querySelector<HTMLElement>(
    '[aria-label="Evidence and setup details"]',
  )!;
  expect(guidance.textContent).toContain('A collection filter is configured');
  view.select('Evidence source', 'imported');
  view.select('Activity view', 'events');
  view.select('Event preset', 'voice');
  expect(guidance.textContent).toContain('1 event hidden by view filters');
  expect(guidance.textContent).not.toContain(
    'A collection filter is configured',
  );
  expect(
    guidance.querySelector('[data-guidance="server"] h3')?.textContent,
  ).toBe('Server events retained');
  expect(guidance.textContent).toContain('Recorded app');
  view.select('App instance', 'app-a');
  expect(
    guidance.querySelector('[data-guidance="voice"] h3')?.textContent,
  ).toBe('No voice events in the viewer window');
  expect(guidance.querySelectorAll('[data-guidance="apps"] p')).toHaveLength(1);
  view.select('Evidence source', 'live');
  expect(guidance.textContent).toContain(
    'Live activity contains metadata only',
  );
  expect(guidance.textContent).toContain('Attached');
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('live eviction and stopped-recording loss have separate explanations and loss counts', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 1,
    maxRequestEvents: 2,
    capture: { maxEvents: 2 },
  });
  const emit = attach(tools);
  const view = mount(tools);
  tools.clear();
  for (const request of ['one', 'two', 'three'])
    emit('client.request.started', {}, request);
  const guidance = view.shadow.querySelector<HTMLElement>(
    '[aria-label="Evidence and setup details"]',
  )!;
  expect(guidance.textContent).toContain('2 recent events evicted');
  expect(guidance.textContent).toContain('1 request event evicted');
  tools.startCapture();
  emit('engine.planner.started', {}, 'new');
  tools.stopCapture();
  view.select('Evidence source', 'recording');
  expect(guidance.textContent).toContain('3 recording events dropped');
  expect(guidance.textContent).not.toContain('recent events evicted');
  expect(guidance.textContent).not.toContain('request event evicted');
  expect(guidance.textContent).toContain('Recorded content is selective');
  expect(tools.capture.getSnapshot().active).toBe(false);
});
