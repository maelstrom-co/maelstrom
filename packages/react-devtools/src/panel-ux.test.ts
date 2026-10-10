import { afterEach, expect, spyOn, test } from 'bun:test';
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
import {
  createDevtools,
  type Devtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';
import {
  ActionName,
  defineVessel,
  InstanceId,
  ok,
  SessionId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { fireEvent, waitFor } from '@testing-library/react';

const instanceId = InstanceId('panel-counter');
const vessel = defineVessel({
  id: 'panel-counter',
  name: 'Panel counter',
  description: 'Counter fixture for readable diagnostics.',
  defaultVariant: 'main',
  variants: {
    main: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'increment', description: 'Increment the counter' }],
    },
  },
});
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function connector(): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    subscribe: () => () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
    process: async (message) => ({
      type: 'maelstrom_response',
      requestId: message.id,
      rationale: 'fixture',
      userMessage: 'Counter updated',
      executionPlan: [{ instanceId, action: ActionName('increment') }],
      layout: {
        type: 'tiling',
        tree: [tilingLeafToken(instanceId)],
        instances: [
          {
            instanceId,
            vesselId: VesselId(vessel.id),
            variant: VariantName('main'),
          },
        ],
      },
    }),
  };
}
async function clientFor(tools: Devtools) {
  const client = new Orchestrator(connector(), {
    sessionId: SessionId('shared-panel-session'),
    vessels: [vessel],
    readyTimeoutMs: 1,
  });
  const detach = tools.attach(client);
  cleanups.push(() => client.dispose(), detach);
  client.commandProcessor.registerRunner(instanceId, {
    increment: () => ok(undefined),
  });
  await client.connect();
  await client.processIntent('unrecorded private intent');
  await client.commandProcessor.waitForIdle();
  return { client, detach };
}
function collector() {
  const tools = createDevtools({ initialIsOpen: true });
  cleanups.push(() => tools.dispose());
  return tools;
}

test('uncorrelated tool outcomes remain evidence without inventing a connection', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emit('voice.session.connected', {
    provider: 'example',
    providerInstanceId: 'voice',
    generation: 2,
    generationScope: 'session',
  });
  client.diagnostics.emit('voice.tool.completed', {
    provider: 'example',
    providerInstanceId: 'voice',
    generationScope: 'session',
    callId: 'old-call',
  });
  const { shadow, click } = mount(tools);
  click('Connections');
  expect(shadow.textContent).not.toContain('State not reported');
  expect(
    tools
      .getSnapshot()
      .activity.some((event) => event.kind === 'voice.tool.completed'),
  ).toBe(true);
});

test('evicting older activity preserves the selected retained event', async () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 3 });
  cleanups.push(() => tools.dispose());
  const { client } = await clientFor(tools);
  for (const name of ['one', 'two', 'three'])
    client.diagnostics.emit(`fixture.${name}`);
  const { shadow, select } = mount(tools);
  select('Activity view', 'events');
  const row = Array.from(shadow.querySelectorAll('.list-pane button')).find(
    (button) => button.textContent?.includes('Fixture two'),
  );
  if (!row) throw new Error('Expected the retained event');
  fireEvent.click(row);
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Fixture two',
  );
  client.diagnostics.emit('fixture.four');
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Fixture two',
  );
});

test('new request activity does not erode or replace the selected request', async () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 4 });
  cleanups.push(() => tools.dispose());
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emit('client.request.started', {}, undefined, 'first');
  client.diagnostics.emit(
    'client.action.completed',
    { outcome: 'succeeded' },
    undefined,
    'first',
  );
  client.diagnostics.emit('client.response.applied', {}, undefined, 'first');
  const { shadow } = mount(tools);
  const row = shadow.querySelector('.list-pane button');
  if (!row) throw new Error('Expected the first request');
  fireEvent.click(row);
  const before = shadow.querySelector('.content-pane')?.textContent;
  const details = shadow.querySelector<HTMLDetailsElement>(
    '.content-pane details',
  );
  if (!details) throw new Error('Expected request details');
  details.open = true;
  for (const kind of [
    'client.request.started',
    'engine.planner.started',
    'client.response.received',
    'client.response.applied',
  ]) {
    client.diagnostics.emit(kind, {}, undefined, 'second');
    expect(shadow.querySelector('.content-pane')?.textContent).toBe(before);
    expect(shadow.querySelector('.list-pane')?.textContent).toContain(
      'Request first',
    );
    expect(shadow.querySelector('.content-pane details')).toBe(details);
    expect(details.open).toBe(true);
  }
});

test('automatic selection stays on its request and expiration never selects another request', async () => {
  const tools = createDevtools({ initialIsOpen: true, maxRequestEvents: 3 });
  cleanups.push(() => tools.dispose());
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emit('client.request.started', {}, undefined, 'first');
  client.diagnostics.emit('client.response.applied', {}, undefined, 'first');
  const { shadow } = mount(tools);
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request first',
  );
  client.diagnostics.emit('client.request.started', {}, undefined, 'second');
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request first',
  );
  client.diagnostics.emit('client.response.applied', {}, undefined, 'second');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'The selected request is no longer retained',
  );
  expect(shadow.querySelector('pre')?.textContent ?? '').not.toContain('first');
  expect(
    shadow.querySelector('.list-pane button[aria-pressed="true"]'),
  ).toBeNull();
  const row = shadow.querySelector('.list-pane button');
  if (!row) throw new Error('Expected the second request');
  expect(row.textContent).toContain('Request second');
  fireEvent.click(row);
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request second',
  );
});
function mount(tools: Devtools) {
  const unmount = mountDevtools(tools);
  cleanups.push(unmount);
  const shadow = document.querySelector(
    '[data-maelstrom-devtools]',
  )?.shadowRoot;
  if (!shadow) throw new Error('Expected shared panel');
  const click = (name: string) => {
    const target = Array.from(shadow.querySelectorAll('button')).find(
      (node) => node.textContent === name,
    );
    if (!target) throw new Error(`Missing button ${name}`);
    fireEvent.click(target);
  };
  const select = (name: string, value: string) => {
    const target = shadow.querySelector(`select[aria-label="${name}"]`);
    if (!target) throw new Error(`Missing select ${name}`);
    fireEvent.change(target, { target: { value } });
  };
  return { shadow, click, select, unmount };
}

test('the live request view explains outcomes without reading intent content', async () => {
  const tools = collector();
  await clientFor(tools);
  const { shadow, click } = mount(tools);
  expect(shadow.textContent).toContain('Why did the UI change?');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'The client completed the response command batch',
  );
  expect(shadow.textContent).not.toContain('unrecorded private intent');
  click('Inspector');
  expect(
    shadow.querySelector('[aria-label="Chart layout preview"]'),
  ).not.toBeNull();
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Increment the counter',
  );
});

test('JSON exploration preserves exact inert evidence and collapsed nodes during unrelated updates', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  const markup = '<img src=x onerror="throw 1"> &lt;literal&gt;';
  const payload = {
    '': 'empty property name',
    null: 'literal property name',
    nested: { [markup]: ['a "quoted" value', false, null, -12.5, {}] },
  };
  tools.startCapture();
  client.diagnostics.emit('client.request.started', {}, undefined, 'json');
  client.diagnostics.emit(
    'client.response.applied',
    { label: markup, count: 4, enabled: true, absent: null },
    () => payload,
    'json',
  );
  tools.stopCapture();
  const { shadow, click } = mount(tools);
  click('Recordings');
  click('Inspect recording');
  const raw = shadow.querySelector<HTMLPreElement>('.json-raw');
  const tree = shadow.querySelector<HTMLElement>('.json-tree');
  if (!raw || !tree) throw new Error('Expected JSON presentations');
  expect(tree.hidden).toBe(false);
  expect(raw.hidden).toBe(true);
  click('Expand all');
  expect(tree.textContent).toContain(markup);
  expect(
    Array.from(tree.querySelectorAll('.json-key'), (node) => node.textContent),
  ).toContain('""');
  expect(
    Array.from(tree.querySelectorAll('.json-key'), (node) => node.textContent),
  ).toContain('null');
  expect(tree.querySelector('img, script, iframe')).toBeNull();
  expect(JSON.parse(raw.textContent ?? '{}').content.nested).toEqual(
    payload.nested,
  );
  expect(
    raw.querySelectorAll(
      '.json-key, .json-string, .json-number, .json-boolean, .json-null',
    ).length,
  ).toBeGreaterThan(5);
  const nested = tree.querySelector<HTMLElement>(
    '[aria-label="Collapse nested"]',
  );
  if (!nested) throw new Error('Expected the nested JSON object');
  fireEvent.keyDown(nested, { key: 'Enter' });
  expect(nested.getAttribute('aria-expanded')).toBe('false');
  click('Raw JSON');
  expect(raw.hidden).toBe(false);
  const originalText = raw.textContent;
  click('Tree');
  client.diagnostics.emit('voice.session');
  expect(tree.querySelector('[aria-label="Expand nested"]')).toBe(nested);
  expect(raw.textContent).toBe(originalText);
  click('Raw JSON');
  click('Close');
  click('◉ Maelstrom');
  expect(shadow.querySelector('.json-raw')?.hasAttribute('hidden')).toBe(false);
  tools.capture.addRedactor((value) =>
    JSON.parse(JSON.stringify(value).replaceAll('quoted', 'masked')),
  );
  expect(shadow.querySelector('.json-raw')?.textContent).not.toContain(
    'quoted',
  );
  expect(shadow.querySelector('.json-tree')?.textContent).not.toContain(
    'quoted',
  );
});

test('recording scope stays pinned when the inspection filter changes', async () => {
  const tools = collector();
  const first = await clientFor(tools);
  const second = await clientFor(tools);
  const firstId = tools.getSnapshot().sessions[0].id,
    secondId = tools.getSnapshot().sessions[1].id;
  const { shadow, click, select } = mount(tools);
  select('App instance', firstId);
  click('Recordings');
  select('Recording scope', firstId);
  click('Start recording');
  select('App instance', secondId);
  expect(shadow.querySelector('.source-banner')?.textContent).toContain(
    'Recording content for App instance 1',
  );
  second.client.diagnostics.emit('fixture.note', {}, () => ({
    text: 'excluded second app',
  }));
  first.client.diagnostics.emit('fixture.note', {}, () => ({
    text: 'included first app',
  }));
  click('Stop');
  const exported = tools.exportCapture();
  expect(exported).toContain('included first app');
  expect(exported).not.toContain('excluded second app');
  expect(shadow.textContent).toContain('Stopped');
});

test('finished and imported recordings use readable views without reading or commanding the live client', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  const { shadow, click, select } = mount(tools);
  click('Recordings');
  click('Start recording');
  await client.processIntent('recorded private intent');
  await client.commandProcessor.waitForIdle();
  click('Stop');
  click('Inspect recording');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'recorded private intent',
  );
  const file = tools.exportCapture();
  let inspections = 0;
  const original = tools.inspect;
  tools.inspect = (id) => {
    inspections++;
    return original(id);
  };
  const process = spyOn(client, 'processIntent');
  tools.importCapture(file);
  select('Evidence source', 'imported');
  click('Inspector');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Panel counter',
  );
  expect(inspections).toBe(0);
  expect(process).not.toHaveBeenCalled();
  expect(shadow.textContent).toContain('Read-only evidence');
});

test('typing notes and receiving live activity never reserializes a stopped recording', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  const { shadow, click } = mount(tools);
  const exported = spyOn(tools.capture, 'export');
  click('Recordings');
  click('Start recording');
  client.diagnostics.emit('fixture.note', {}, () => ({ text: 'recorded' }));
  click('Stop');
  const calls = exported.mock.calls.length;
  const note = shadow.querySelector('textarea');
  if (!note) throw new Error('Expected note field');
  fireEvent.input(note, { target: { value: 'Useful reproduction note' } });
  for (let i = 0; i < 10; i++)
    client.diagnostics.emit('fixture.metadata', { sequence: i });
  expect(exported.mock.calls.length).toBe(calls);
  expect(note.value).toBe('Useful reproduction note');
});

test('clearing a recording preserves live activity and closing an import releases its view', async () => {
  const tools = collector();
  await clientFor(tools);
  const { shadow, click, select } = mount(tools);
  click('Recordings');
  click('Start recording');
  click('Stop');
  const file = tools.exportCapture();
  const activity = tools.getSnapshot().activity.length;
  click('Clear recording');
  expect(tools.getSnapshot().activity.length).toBe(activity);
  expect(tools.capture.getSnapshot().count).toBe(0);
  tools.importCapture(file);
  select('Evidence source', 'imported');
  click('Recordings');
  click('Close imported recording');
  await waitFor(() => expect(tools.getSnapshot().imported).toBeNull());
  expect(
    shadow.querySelector<HTMLSelectElement>(
      'select[aria-label="Evidence source"]',
    )?.value,
  ).toBe('live');
});

test('an imported note is read-only and cannot overwrite the current recording', async () => {
  const tools = collector();
  await clientFor(tools);
  const { shadow, click, select } = mount(tools);
  click('Recordings');
  click('Start recording');
  click('Stop');
  tools.capture.setOutcome('Current recording note');
  const file = JSON.parse(tools.exportCapture());
  file.capture.outcome = 'Imported recording note';
  tools.importCapture(JSON.stringify(file));
  select('Evidence source', 'imported');
  click('Recordings');
  const note = shadow.querySelector('textarea');
  if (!note) throw new Error('Expected recorded note');
  expect(note.readOnly).toBe(true);
  expect(note.value).toBe('Imported recording note');
  fireEvent.input(note, { target: { value: 'Attempted edit' } });
  expect(tools.capture.getSnapshot().outcome).toBe('Current recording note');
  const exportButton = Array.from(shadow.querySelectorAll('button')).find(
    (button) => button.textContent === 'Export JSON',
  );
  expect(exportButton?.hidden).toBe(true);
});

test('a new redaction policy replaces already displayed recording content', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  const { shadow, click } = mount(tools);
  click('Recordings');
  click('Start recording');
  await client.processIntent('business value to redact');
  await client.commandProcessor.waitForIdle();
  click('Stop');
  click('Inspect recording');
  expect(shadow.textContent).toContain('business value to redact');
  tools.capture.addRedactor((value) =>
    JSON.parse(
      JSON.stringify(value).replaceAll(
        'business value to redact',
        '[REDACTED]',
      ),
    ),
  );
  await waitFor(() =>
    expect(shadow.textContent).not.toContain('business value to redact'),
  );
});
