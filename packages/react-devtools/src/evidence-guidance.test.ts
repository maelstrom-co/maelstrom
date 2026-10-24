import { expect, test } from 'bun:test';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { event, attach, mount } = createVoicePanelHarness();

test('optional explanations start closed and retain independent disclosure state and focus during live updates', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 1 });
  const emit = attach(tools);
  tools.startCapture();
  tools.stopCapture();
  const view = mount(tools);
  view.click('Evidence & setup');
  const row = (id: string) => {
    const result = view.shadow.querySelector<HTMLDetailsElement>(
      `details[data-guidance="${id}"]`,
    );
    if (!result) throw new Error(`Missing guidance disclosure ${id}`);
    return result;
  };
  const server = row('server');
  const voice = row('voice');
  expect(server.open).toBe(false);
  expect(voice.open).toBe(false);
  server.open = true;
  voice.open = true;
  const summary = server.querySelector('summary')!;
  summary.focus();
  emit('engine.planner.started', {}, 'request');
  expect(row('server')).toBe(server);
  expect(row('voice')).toBe(voice);
  expect(server.open).toBe(true);
  expect(voice.open).toBe(true);
  expect(view.shadow.activeElement).toBe(summary);
  expect(summary.textContent).toBe('Engine diagnostics available');
  expect(server.textContent).toContain('Planner evidence');
  expect(row('recent-loss').open).toBe(false);
  view.select('Evidence source', 'recording');
  expect(row('server').open).toBe(true);
  expect(summary.textContent).toBe('Planner details unavailable in this view');
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('a disappearing guidance disclosure returns keyboard focus to its available trigger', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 1 });
  const emit = attach(tools);
  const view = mount(tools);
  view.click('Evidence & setup');
  emit('app.event');
  const summary = view.shadow.querySelector<HTMLElement>(
    '[data-guidance="recent-loss"] summary',
  );
  expect(summary).not.toBeNull();
  summary?.focus();
  tools.clear();
  expect(view.shadow.querySelector('[data-guidance="recent-loss"]')).toBeNull();
  expect(view.shadow.activeElement?.getAttribute('aria-label')).toBe(
    'Evidence & setup',
  );
});

test('unlinked voice metadata captured before eviction is inspectable through the recommended recording flow', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 1 });
  const emit = attach(tools);
  tools.startCapture();
  emit('voice.transport', {
    state: 'closed',
    providerInstanceId: '[REDACTED]',
  });
  emit('app.event');
  tools.stopCapture();
  expect(
    tools.getSnapshot().activity.some((item) => item.kind.startsWith('voice.')),
  ).toBe(false);
  const view = mount(tools);
  view.click('Connections');
  expect(
    view.shadow.querySelector('[data-guidance="voice"] summary')?.textContent,
  ).toBe('Voice metadata cannot be linked');
  view.click('Recordings');
  view.click('Inspect recording');
  expect(
    view.shadow.querySelector<HTMLSelectElement>(
      '[aria-label="Evidence source"]',
    )?.value,
  ).toBe('recording');
  view.select('Activity view', 'events');
  expect(view.shadow.querySelector('.list-pane')?.textContent).toContain(
    'Voice transport',
  );
  expect(
    view.shadow.querySelector('[data-guidance="voice"] summary')?.textContent,
  ).toBe('Voice observations available');
});

test('setup links keep keyboard focus while live evidence updates without activating capture', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 1 });
  const emit = attach(tools);
  const view = mount(tools);
  view.click('Evidence & setup');
  const guides =
    view.shadow.querySelector<HTMLDetailsElement>('.guidance-guides')!;
  expect(guides.open).toBe(false);
  guides.open = true;
  const link = view.shadow.querySelector<HTMLAnchorElement>(
    'a[aria-label^="Engine diagnostics setup guide"]',
  );
  expect(link).not.toBeNull();
  link?.focus();
  emit('app.event');
  expect(view.shadow.activeElement).toBe(link);
  expect(link?.href).toBe(
    'https://docs.maelstrom-ai.co/guides/devtools/#enable-optional-engine-evidence',
  );
  expect(link?.target).toBe('_blank');
  expect(link?.rel).toBe('noopener noreferrer');
  expect(tools.capture.getSnapshot()).toMatchObject({
    active: false,
    count: 0,
  });
});

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
    view.shadow.querySelector('[data-guidance="voice"] summary')?.textContent;
  expect(view.shadow.querySelector('.connections-grid')?.textContent).toContain(
    'Fixture',
  );
  expect(view.shadow.querySelector('.connections-grid')?.textContent).toContain(
    'closed',
  );
  expect(voice()).toBe('Voice observations available');
  view.select('App instance', b.id);
  expect(voice()).toBe('No voice activity in this view');
  view.select('App instance', a.id);
  expect(voice()).toBe('Voice observations available');
  for (const source of ['recording', 'imported']) {
    view.select('Evidence source', source);
    expect(voice()).toBe('No voice activity in this view');
  }
  view.select('Evidence source', 'live');
  expect(voice()).toBe('Voice observations available');
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
    view.shadow.querySelector('[data-guidance="attachment"] summary')
      ?.textContent,
  ).toBe('App snapshot unavailable in this view');
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
    'Planner details unavailable in this view',
  );
  expect(guidance?.textContent).toContain(
    'Prompts and arguments need a recording',
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
  expect(guidance?.textContent).toContain('Engine diagnostics available');
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
  expect(guidance.textContent).toContain('Your app has a collection filter');
  view.select('Evidence source', 'imported');
  view.select('Activity view', 'events');
  view.select('Event preset', 'voice');
  expect(guidance.textContent).toContain('1 event hidden by view filters');
  expect(guidance.textContent).not.toContain(
    'Your app has a collection filter',
  );
  expect(
    guidance.querySelector('[data-guidance="server"] summary')?.textContent,
  ).toBe('Engine diagnostics available');
  expect(guidance.textContent).toContain('Recorded app');
  view.select('App instance', 'app-a');
  expect(
    guidance.querySelector('[data-guidance="apps"] summary')?.textContent,
  ).toBe('App instances (1)');
  expect(guidance.querySelector('.guidance-scope')?.textContent).toContain(
    'Event counts: all apps',
  );
  expect(
    guidance.querySelector('[data-guidance="voice"] summary')?.textContent,
  ).toBe('No voice activity in this view');
  expect(guidance.querySelectorAll('[data-guidance="apps"] p')).toHaveLength(1);
  view.select('Evidence source', 'live');
  expect(guidance.textContent).toContain(
    'Prompts and arguments need a recording',
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
  expect(guidance.textContent).toContain(
    'Some recorded content may be missing',
  );
  expect(tools.capture.getSnapshot().active).toBe(false);
});
