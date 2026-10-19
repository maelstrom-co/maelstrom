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
  err,
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

test('Connections highlights the selected connection or voice event beside its JSON', () => {
  const tools = collector();
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          {
            id: 'connection-selected',
            sessionId: 'session',
            kind: 'client.connection.changed',
            metadata: { clientId: 'app', status: 'connected' },
          },
          {
            id: 'voice-selected',
            sessionId: 'session',
            kind: 'voice.session.changed',
            metadata: {
              clientId: 'app',
              providerInstanceId: 'voice',
              state: 'connected',
            },
          },
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Connections');
  click('Raw JSON');
  const row = (label: string) =>
    Array.from(shadow.querySelectorAll('.content-pane button')).find((node) =>
      node.textContent?.startsWith(label),
    )!;
  const json = () =>
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent;
  fireEvent.click(row('Engine connection changed'));
  expect(row('Engine connection changed').getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(row('Voice session changed').getAttribute('aria-pressed')).toBe(
    'false',
  );
  expect(json()).toContain('connection-selected');
  fireEvent.click(row('Voice session changed'));
  expect(row('Engine connection changed').getAttribute('aria-pressed')).toBe(
    'false',
  );
  expect(row('Voice session changed').getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(json()).toContain('voice-selected');
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

test('two requests from different app lifetimes stay distinct in a side-by-side comparison', () => {
  const tools = collector();
  const event = (
    clientId: string,
    kind: string,
    metadata: Record<string, unknown> = {},
  ) => ({
    id: crypto.randomUUID(),
    sessionId: 'shared',
    requestId: 'same-request',
    kind,
    metadata: { clientId, ...metadata },
  });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('app-a', 'client.request.started'),
          event('app-a', 'client.response.received', {
            source: 'request',
            durationMs: 40,
          }),
          event('app-a', 'client.response.applied', { durationMs: 12 }),
          event('app-b', 'client.request.started'),
          event('app-b', 'client.request.failed', {
            durationMs: 90,
            category: 'transport',
          }),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Compare request');
  const other = Array.from(shadow.querySelectorAll('.list-pane button')).find(
    (node) => node.textContent?.includes('App instance 1'),
  );
  expect(other).toBeDefined();
  fireEvent.click(other!);
  const left = shadow.querySelector('[aria-label="Comparison A"]');
  const right = shadow.querySelector('[aria-label="Comparison B"]');
  expect(left?.textContent).toContain('App instance 2');
  expect(left?.textContent).toContain('Failed');
  expect(right?.textContent).toContain('App instance 1');
  expect(right?.textContent).toContain('Applied');
  expect(
    shadow.querySelector('[aria-label="Compared request timings"]')
      ?.textContent,
  ).toContain('−50 ms');
  expect(left?.querySelector('[aria-label="Request phases"]')).not.toBeNull();
  expect(right?.querySelector('[aria-label="Request phases"]')).not.toBeNull();
});

test('comparison identities survive new activity and eviction without showing a different request’s JSON', async () => {
  const tools = createDevtools({ initialIsOpen: true, maxRequestEvents: 6 });
  cleanups.push(() => tools.dispose());
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'first',
  );
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'second',
  );
  const { shadow, click } = mount(tools);
  click('Compare request');
  fireEvent.click(
    Array.from(shadow.querySelectorAll('.list-pane button')).find((node) =>
      node.textContent?.includes('Request first'),
    )!,
  );
  const comparison = () =>
    shadow.querySelector('[aria-label="Request comparison"]')!;
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'third',
  );
  expect(
    comparison().querySelector('[aria-label="Comparison A"]')?.textContent,
  ).toContain('Request second');
  expect(
    comparison().querySelector('[aria-label="Comparison B"]')?.textContent,
  ).toContain('Request first');
  const layoutDisclosure = () =>
    Array.from(
      comparison()
        .querySelector('[aria-label="Comparison A"]')!
        .querySelectorAll('details'),
    ).find(
      (node) => node.querySelector('summary')?.textContent === 'Layout changes',
    )!;
  layoutDisclosure().open = true;
  client.diagnostics.emitDiagnostic(
    'engine.stage.failed',
    { stage: 'plan', outcome: 'failed' },
    undefined,
    'second',
  );
  expect(layoutDisclosure().open).toBe(true);
  const filter = shadow.querySelector('input[type="search"]')!;
  fireEvent.input(filter, { target: { value: 'third' } });
  expect(comparison().textContent).toContain(
    'hidden from the list by the current filters',
  );
  fireEvent.input(filter, { target: { value: '' } });
  for (let i = 0; i < 6; i++)
    client.diagnostics.emitDiagnostic(
      'client.request.started',
      {},
      undefined,
      `new-${i}`,
    );
  const left = comparison().querySelector('[aria-label="Comparison A"]')!;
  const right = comparison().querySelector('[aria-label="Comparison B"]')!;
  expect(left.textContent).toContain('Request second');
  expect(right.textContent).toContain('Request first');
  expect(left.textContent).toContain('no longer retained');
  expect(right.textContent).toContain('no longer retained');
  expect(left.querySelector('[aria-label="A event JSON"]') === null).toBe(true);
  expect(right.querySelector('[aria-label="B event JSON"]') === null).toBe(
    true,
  );
  expect(tools.getSnapshot().requestActivity.length).toBeLessThanOrEqual(6);
});

test.each([
  'source',
  'replacement',
  'app',
])('comparison state clears when its %s changes', async (change) => {
  const tools = collector();
  await clientFor(tools);
  const capture = JSON.stringify({
    schemaVersion: 2,
    capture: {
      schemaVersion: 1,
      events: ['a', 'b'].map((app) => ({
        id: `start-${app}`,
        sessionId: 'shared',
        requestId: 'same-request',
        kind: 'client.request.started',
        metadata: { clientId: app },
      })),
    },
  });
  tools.importCapture(capture);
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Compare request');
  expect(
    shadow.querySelector('[aria-label="Request comparison"]') !== null,
  ).toBe(true);
  if (change === 'source') select('Evidence source', 'live');
  if (change === 'replacement') {
    click('Close');
    tools.importCapture(capture);
    click('Open Maelstrom Devtools');
  }
  if (change === 'app') select('App instance', 'a');
  expect(shadow.querySelector('[aria-label="Request comparison"]')).toBeNull();
  expect(
    Array.from(shadow.querySelectorAll('button')).some(
      (node) => node.textContent === 'Compare request',
    ),
  ).toBe(true);
});

test('comparison preserves repeated attempts and Actions while inspecting each request’s recorded content', () => {
  const tools = collector();
  const values = ['a', 'b'].flatMap((app) => [
    {
      id: `${app}-first`,
      sessionId: 'shared',
      requestId: app,
      kind: 'engine.stage.failed',
      metadata: {
        clientId: 'app',
        stage: 'plan',
        outcome: 'failed',
        durationMs: app === 'a' ? 5 : 10,
      },
      content: { error: `recorded ${app}` },
    },
    {
      id: `${app}-retry`,
      sessionId: 'shared',
      requestId: app,
      kind: 'engine.stage.completed',
      metadata: {
        clientId: 'app',
        stage: 'plan',
        outcome: 'succeeded',
        durationMs: 7,
      },
    },
    ...['succeeded', 'failed'].map((outcome, index) => ({
      id: `${app}-action-${index}`,
      sessionId: 'shared',
      requestId: app,
      kind: 'client.action.completed',
      metadata: {
        clientId: 'app',
        action: 'open',
        instanceId: 'calendar',
        toolCallId: 'reused',
        outcome,
      },
      content: { argument: `recorded action ${app}-${index}` },
    })),
  ]);
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: { schemaVersion: 1, events: values },
    }),
  );
  const { shadow, click } = mount(tools);
  const source = shadow.querySelector('select[aria-label="Evidence source"]')!;
  fireEvent.change(source, { target: { value: 'imported' } });
  click('Compare request');
  fireEvent.click(
    Array.from(shadow.querySelectorAll('.list-pane button')).find((node) =>
      node.textContent?.includes('Request a'),
    )!,
  );
  const left = () => shadow.querySelector('[aria-label="Comparison A"]')!;
  const right = () => shadow.querySelector('[aria-label="Comparison B"]')!;
  expect(left().querySelectorAll('.phase-table tbody tr')).toHaveLength(4);
  expect(right().querySelectorAll('.phase-table tbody tr')).toHaveLength(4);
  expect((left().querySelector('.phase-bar') as HTMLElement).style.width).toBe(
    '100%',
  );
  expect((right().querySelector('.phase-bar') as HTMLElement).style.width).toBe(
    '50%',
  );
  expect(left().textContent).toContain('Partial evidence');
  expect(right().textContent).toContain('No final client outcome');
  fireEvent.click(left().querySelector('.phase-select')!);
  click('A event JSON: Raw JSON');
  expect(left().querySelector('.json-raw')?.textContent).toContain(
    'recorded b',
  );
  fireEvent.click(right().querySelectorAll('.phase-select')[3]);
  click('B event JSON: Raw JSON');
  expect(right().querySelector('.json-raw')?.textContent).toContain(
    'recorded action a-1',
  );
  expect(
    left().querySelector('.phase-select')?.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(
    right().querySelectorAll('.phase-select')[3].getAttribute('aria-pressed'),
  ).toBe('true');
  expect(left().querySelector('.json-raw')?.textContent).toContain(
    'recorded b',
  );
  fireEvent.change(left().querySelector('input[type="checkbox"]')!, {
    target: { checked: false },
  });
  expect(
    (left().querySelector('input[type="checkbox"]') as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(
    (right().querySelector('input[type="checkbox"]') as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('a selected comparison phase expires without silently replacing its JSON', async () => {
  const tools = createDevtools({ initialIsOpen: true, maxRequestEvents: 6 });
  cleanups.push(() => tools.dispose());
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'long-request',
  );
  const { shadow, click } = mount(tools);
  click('Compare request');
  fireEvent.click(
    shadow.querySelector('[aria-label="Comparison A"] .phase-select')!,
  );
  for (let i = 0; i < 7; i++)
    client.diagnostics.emitDiagnostic(
      'client.command.completed',
      { command: 'execute_actions', durationMs: i },
      undefined,
      'long-request',
    );
  expect(
    shadow.querySelector('[aria-label="Comparison A"]')?.textContent,
  ).toContain('Selected phase is no longer retained');
  click('A event JSON: Raw JSON');
  expect(
    shadow.querySelector('[aria-label="A event JSON"] .json-raw')
      ?.textContent ?? '',
  ).toContain('The selected event is no longer retained');
});

test('recorded request layouts explain added Instances and open their supporting JSON', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  client.commandProcessor.setLayout({
    type: 'tiling',
    tree: [],
    instances: [],
  });
  await client.commandProcessor.waitForIdle();
  const { shadow, click, select } = mount(tools);
  click('Recordings');
  click('Start recording');
  await client.processIntent('Show the counter');
  await client.commandProcessor.waitForIdle();
  click('Stop');
  click('Requests');
  select('Evidence source', 'recording');
  const comparison = shadow.querySelector(
    '[aria-label="Request layout comparison"]',
  );
  expect(comparison?.textContent).toContain('Added');
  expect(
    comparison?.querySelectorAll('[aria-label$="Chart miniature"]').length,
  ).toBe(2);
  fireEvent.click(shadow.querySelector('[aria-label="panel-counter: Added"]')!);
  click('Raw JSON');
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toContain('layoutSnapshot');
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toContain('client.response.applied');
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('imported layout evidence remains readable when command metadata is structured', () => {
  const tools = collector();
  const snapshot = {
    version: 1,
    instanceCount: 1,
    instances: [{ instanceId: 'one', vesselId: 'counter', variant: 'main' }],
    layoutMode: 'tiling',
    chartDimensions: { columns: 4, rows: 2 },
    layout: { type: 'tiling', tree: ['ID:one'] },
  };
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          {
            id: 'before',
            sessionId: 'session',
            requestId: 'request',
            kind: 'client.command.started',
            metadata: { clientId: 'app', command: 'set_layout' },
            content: { layoutSnapshot: snapshot },
          },
          {
            id: 'odd-command',
            sessionId: 'session',
            requestId: 'request',
            kind: 'client.command.completed',
            metadata: { clientId: 'app', command: { toString: null } },
          },
          {
            id: 'after',
            sessionId: 'session',
            requestId: 'request',
            kind: 'client.response.applied',
            metadata: { clientId: 'app' },
            content: {
              layoutSnapshot: {
                ...snapshot,
                instances: [
                  { instanceId: 'one', vesselId: 'counter', variant: 'week' },
                ],
              },
            },
          },
        ],
      },
    }),
  );
  const { shadow, select } = mount(tools);
  select('Evidence source', 'imported');
  expect(
    shadow.querySelector('[aria-label="Request layout comparison"]')
      ?.textContent,
  ).toContain('Variant changed');
  expect(shadow.querySelector('.layout-evidence')?.textContent).toContain(
    'Command completed',
  );
});

test.each([
  'before tile',
  'after tile',
  'change row',
])('selecting a layout %s reveals its phase while layout paging preserves the phase page', (selection) => {
  const tools = collector();
  const instances = Array.from({ length: 201 }, (_, index) => ({
    instanceId: `one-${index}`,
    vesselId: 'counter',
    variant: 'main',
  }));
  const snapshot = {
    version: 1,
    instanceCount: instances.length,
    instances,
    layoutMode: 'tiling',
    chartDimensions: { columns: 4, rows: 2 },
    layout: { type: 'tiling', tree: ['ID:one-0'] },
  };
  const identity = { sessionId: 'session', requestId: 'request' };
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          {
            ...identity,
            id: 'before',
            kind: 'client.command.started',
            metadata: { clientId: 'app', command: 'set_layout' },
            content: { layoutSnapshot: snapshot },
          },
          ...Array.from({ length: 205 }, (_, index) => ({
            ...identity,
            id: `step-${index}`,
            kind: 'engine.stage.completed',
            metadata: {
              clientId: 'app',
              stage: `step-${index}`,
              outcome: 'succeeded',
            },
          })),
          {
            ...identity,
            id: 'after',
            kind: 'client.response.applied',
            metadata: { clientId: 'app' },
            content: {
              layoutSnapshot: {
                ...snapshot,
                instances: instances.map((instance) => ({
                  ...instance,
                  variant: 'week',
                })),
              },
            },
          },
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Raw JSON');
  click('After');
  click('Previous phases');
  const before = selection === 'before tile';
  if (before) click('Show more phases');
  const phases = () =>
    shadow.querySelector('table[aria-label="Request phases"]')!;
  const retainedPage = before ? 'step-204' : 'step-0';
  expect(phases().textContent).toContain(retainedPage);
  click('More changes');
  expect(phases().textContent).toContain(retainedPage);
  const label =
    selection === 'change row'
      ? 'one-200: Variant changed'
      : `${before ? 'Before' : 'After'} Instance one-0: Variant changed`;
  fireEvent.click(shadow.querySelector(`[aria-label="${label}"]`)!);
  const selectedPhase = phases().querySelector('button[aria-pressed="true"]');
  expect(selectedPhase).not.toBeNull();
  expect(selectedPhase?.textContent).toContain(
    before ? 'Layout started' : 'Response applied',
  );
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toContain(`"id": "${before ? 'before' : 'after'}"`);
});

test.each([
  'same-request',
  'different-request',
])('replacement imports clear closed-panel pins even with request identity %s', async (replacementRequest) => {
  const tools = collector();
  const file = (version: string, requestId = 'same-request') =>
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        active: false,
        metadata: {},
        events: [
          {
            id: `event-${version}`,
            sessionId: 'fixture-session',
            requestId,
            kind: 'client.request.started',
            at: 1,
            metadata: { clientId: 'same-app', version },
          },
        ],
      },
    });
  tools.importCapture(file('before'));
  const { shadow, click, select } = mount(tools);
  const reopen = () =>
    fireEvent.click(
      shadow.querySelector('[aria-label="Open Maelstrom Devtools"]')!,
    );
  select('Evidence source', 'imported');
  click('Pin request');
  click('Close');
  reopen();
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Unpin request',
  );
  click('Close');
  tools.importCapture(file('after', replacementRequest));
  reopen();
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toContain('after');
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Unpin request',
  );
});

test('structured imported metadata stays readable even when it shadows object conversion methods', () => {
  const tools = collector();
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        active: false,
        metadata: {},
        events: [
          {
            id: 'structured-meta',
            sessionId: 'fixture',
            requestId: 'request',
            kind: 'client.request.started',
            at: 1,
            metadata: {
              clientId: 'app',
              extra: {
                toString: null,
                valueOf: 0,
                nested: ['<script>alert(1)</script>'],
              },
            },
          },
        ],
      },
    }),
  );
  const { shadow, select } = mount(tools);
  select('Evidence source', 'imported');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Request request',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    '"toString":null',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    '<script>alert(1)</script>',
  );
  expect(shadow.querySelector('.content-pane script')).toBeNull();
});

test('phase rows open their evidence while repeated attempts retain separate durations', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emitDiagnostic(
    'engine.stage.failed',
    { stage: 'plan', outcome: 'failed', durationMs: 5 },
    undefined,
    'phases',
  );
  client.diagnostics.emitDiagnostic(
    'engine.stage.completed',
    { stage: 'plan', outcome: 'succeeded', durationMs: 7 },
    undefined,
    'phases',
  );
  const { shadow } = mount(tools);
  const phases = shadow.querySelector('table[aria-label="Request phases"]');
  expect(phases).not.toBeNull();
  expect(phases?.textContent).toContain('5 ms');
  expect(phases?.textContent).toContain('7 ms');
  const first = phases?.querySelector('button');
  if (!first) throw new Error('Expected phase selection');
  fireEvent.click(first);
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toContain('engine.stage.failed');
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).not.toContain('engine.stage.completed');
  expect(
    shadow.querySelector(
      'table[aria-label="Request phases"] button[aria-pressed="true"]',
    )?.textContent,
  ).toContain('failed');
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('pinning keeps a request above new activity and reports filtering and eviction without replacing it', async () => {
  const tools = createDevtools({ initialIsOpen: true, maxRequestEvents: 60 });
  cleanups.push(() => tools.dispose());
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'pinned',
  );
  const { shadow, click } = mount(tools);
  click('Pin request');
  for (let i = 0; i < 51; i++)
    client.diagnostics.emitDiagnostic(
      'client.request.started',
      {},
      undefined,
      `new-${i}`,
    );
  expect(shadow.querySelector('.list-pane button')?.textContent).toContain(
    'Request pinned',
  );
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request pinned',
  );
  const filter = shadow.querySelector('input[type="search"]')!;
  fireEvent.input(filter, { target: { value: 'new-' } });
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Pinned request is hidden by the current filters',
  );
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')
      ?.textContent ?? '',
  ).not.toContain('new-');
  fireEvent.input(filter, { target: { value: '' } });
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request pinned',
  );
  for (let i = 51; i < 62; i++)
    client.diagnostics.emitDiagnostic(
      'client.request.started',
      {},
      undefined,
      `new-${i}`,
    );
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Pinned request evidence is no longer retained',
  );
  expect(tools.getSnapshot().requestActivity.length).toBeLessThanOrEqual(60);
  click('Unpin request');
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request new-61',
  );
});

test('selecting a phase beyond the first batch keeps that phase visible and the table preference intact', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  for (let i = 0; i < 205; i++)
    client.diagnostics.emitDiagnostic(
      'engine.stage.completed',
      { stage: `step-${i}`, outcome: 'succeeded', durationMs: i },
      undefined,
      'long',
    );
  const { shadow, click } = mount(tools);
  const table = () =>
    shadow.querySelector('table[aria-label="Request phases"]')!;
  expect(table().querySelectorAll('tbody tr')).toHaveLength(200);
  click('Show more phases');
  expect(table().querySelectorAll('tbody tr')).toHaveLength(5);
  expect(table().textContent).toContain('step-200');
  expect(table().textContent).not.toContain('step-199');
  const toggle = shadow.querySelector<HTMLInputElement>(
    '.phase-display input',
  )!;
  fireEvent.click(toggle);
  const last = table().querySelectorAll('button')[4];
  fireEvent.click(last);
  expect(
    table().querySelector('button[aria-pressed="true"]')?.textContent,
  ).toContain('step-204');
  expect(
    shadow.querySelector<HTMLInputElement>('.phase-display input')?.checked,
  ).toBe(false);
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toContain('step-204');
  click('Previous phases');
  expect(table().querySelectorAll('tbody tr')).toHaveLength(200);
  expect(table().textContent).toContain('step-0');
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toContain('step-204');
  client.diagnostics.emitDiagnostic(
    'engine.stage.completed',
    { stage: 'step-205', outcome: 'succeeded', durationMs: 205 },
    undefined,
    'long',
  );
  expect(table().textContent).toContain('step-0');
  click('Show more phases');
  expect(table().querySelectorAll('tbody tr')).toHaveLength(6);
  expect(
    table().querySelector('button[aria-pressed="true"]')?.textContent,
  ).toContain('step-204');
});

test('pins do not cross app lifetimes, evidence sources, or replacement imports', async () => {
  const tools = collector();
  const first = await clientFor(tools);
  const second = await clientFor(tools);
  tools.clear();
  tools.startCapture();
  first.client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'same-id',
  );
  second.client.diagnostics.emitDiagnostic(
    'client.request.failed',
    { outcome: 'cancelled' },
    undefined,
    'same-id',
  );
  tools.stopCapture();
  const file = tools.exportCapture();
  const { shadow, click, select } = mount(tools);
  const sessions = tools.getSnapshot().sessions;
  select('App instance', sessions[0].id);
  click('Pin request');
  select('App instance', sessions[1].id);
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Unpin request',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Cancelled',
  );
  click('Pin request');
  select('Evidence source', 'recording');
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Unpin request',
  );
  click('Pin request');
  tools.importCapture(file);
  select('Evidence source', 'imported');
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Unpin request',
  );
  click('Pin request');
  tools.importCapture(file);
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Unpin request',
  );
  expect(
    shadow.querySelector('table[aria-label="Request phases"]')?.textContent,
  ).toContain('Not reported');
  expect(tools.exportCapture()).toBe(file);
});

test.each([
  { source: 'live', pinned: true, nextSource: 'live', request: 'before' },
  { source: 'recording', pinned: false, nextSource: 'live', request: 'after' },
  {
    source: 'imported',
    pinned: true,
    nextSource: 'imported',
    request: 'before',
  },
])('starting a recording respects the pinned $source evidence lifetime', async ({
  source,
  pinned,
  nextSource,
  request,
}) => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  if (source !== 'live') tools.startCapture();
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'before',
  );
  if (source !== 'live') tools.stopCapture();
  if (source === 'imported') tools.importCapture(tools.exportCapture());
  const { shadow, click, select } = mount(tools);
  select('Evidence source', source);
  click('Pin request');
  click('Recordings');
  if (source === 'live') click('Start recording');
  else tools.startCapture();
  expect(tools.capture.getSnapshot().active).toBe(true);
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'after',
  );
  click('Requests');
  expect(
    shadow.querySelector<HTMLSelectElement>('[aria-label="Evidence source"]')
      ?.value,
  ).toBe(nextSource);
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    `Request ${request}`,
  );
  const pin = shadow.querySelector('[data-focus-key="pin-request"]');
  expect(pin?.getAttribute('aria-pressed')).toBe(String(pinned));
});

test('request timings distinguish whole application, command work, and nested Engine durations', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  for (const [kind, metadata] of [
    ['client.request.started', {}],
    [
      'engine.stage.completed',
      { stage: 'plan', durationMs: 18, outcome: 'succeeded' },
    ],
    ['engine.planner.completed', { durationMs: 20, outcome: 'succeeded' }],
    ['engine.request.completed', { durationMs: 25, outcome: 'succeeded' }],
    ['client.response.received', { source: 'request', durationMs: 40 }],
    ['client.command.completed', { durationMs: 8 }],
    [
      'client.response.applied',
      { durationMs: 12, actionFailures: 0, skippedActions: 0 },
    ],
  ] as const)
    client.diagnostics.emitDiagnostic(kind, metadata, undefined, 'timed');
  const { shadow } = mount(tools);
  const content = shadow.querySelector('.content-pane')!;
  const facts = Object.fromEntries(
    Array.from(content.querySelectorAll('dl > div')).map((item) => [
      item.querySelector('dt')?.textContent,
      item.querySelector('dd')?.textContent,
    ]),
  );
  expect(facts['Request round-trip']).toBe('40 ms');
  expect(facts['Client application']).toBe('12 ms');
  expect(facts['Observed command work']).toBe('8 ms');
  expect(facts['Engine request']).toBe('25 ms');
  expect(facts.Planning).toBe('20 ms');
  expect(facts['Stage: plan']).toBe('18 ms');
  expect(content.textContent).toContain('Nested timings overlap');
});

test('large timing histories render in batches without hiding summary measurements or changing selection', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  for (let index = 0; index < 450; index++)
    client.diagnostics.emitDiagnostic(
      'engine.stage.completed',
      {
        stage: `step-${index}`,
        durationMs: index,
        outcome: 'succeeded',
      },
      undefined,
      'many-timings',
    );
  client.diagnostics.emitDiagnostic(
    'engine.planner.completed',
    { durationMs: 500, outcome: 'succeeded' },
    undefined,
    'many-timings',
  );
  client.diagnostics.emitDiagnostic(
    'engine.request.completed',
    { durationMs: 600, outcome: 'succeeded' },
    undefined,
    'many-timings',
  );
  const { shadow, click } = mount(tools);
  const stages = () =>
    Array.from(shadow.querySelectorAll('.content-pane dt')).filter((node) =>
      node.textContent?.startsWith('Stage:'),
    );
  expect(stages()).toHaveLength(200);
  const summary = Object.fromEntries(
    Array.from(shadow.querySelectorAll('.content-pane dl > div')).map(
      (node) => [
        node.querySelector('dt')?.textContent,
        node.querySelector('dd')?.textContent,
      ],
    ),
  );
  expect(summary.Planning).toBe('500 ms');
  expect(summary['Engine request']).toBe('600 ms');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Showing 200 of 450 stage timings',
  );
  const raw = shadow.querySelector(
    '[aria-label="JSON evidence"] .json-raw',
  )?.textContent;
  click('Show more stage timings');
  expect(stages()).toHaveLength(400);
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toBe(raw);
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'other',
  );
  expect(stages()).toHaveLength(400);
  click('Show more stage timings');
  expect(stages()).toHaveLength(450);
  expect(stages().at(-1)?.textContent).toBe('Stage: step-449');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Showing 450 of 450 stage timings',
  );
  expect(
    Array.from(
      shadow.querySelectorAll<HTMLButtonElement>('.content-pane button'),
    ).find((button) => button.textContent === 'Show more stage timings')
      ?.disabled,
  ).toBe(true);
  expect(tools.getSnapshot().requestActivity).toHaveLength(453);
  const choose = (label: string) => {
    const row = Array.from(
      shadow.querySelectorAll<HTMLButtonElement>('.list-pane button'),
    ).find((button) => button.textContent?.includes(label));
    if (!row) throw new Error(`Missing request ${label}`);
    fireEvent.click(row);
  };
  choose('Request other');
  expect(stages()).toHaveLength(0);
  choose('Request many-timin');
  expect(stages()).toHaveLength(200);
});

test('category filtering finds failed attempts without classifying cancelled requests as failures', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emitDiagnostic(
    'client.request.failed',
    { outcome: 'failed', errorCategory: 'timeout' },
    undefined,
    'timed-out',
  );
  client.diagnostics.emitDiagnostic(
    'client.request.failed',
    { outcome: 'failed' },
    undefined,
    'legacy',
  );
  client.diagnostics.emitDiagnostic(
    'client.request.failed',
    { outcome: 'cancelled', errorCategory: 'timeout' },
    undefined,
    'cancelled',
  );
  client.diagnostics.emitDiagnostic(
    'engine.stage.failed',
    { outcome: 'failed', errorCategory: 'timeout', stage: 'plan' },
    undefined,
    'recovered',
  );
  client.diagnostics.emitDiagnostic(
    'client.response.applied',
    { actionFailures: 0, skippedActions: 0 },
    undefined,
    'recovered',
  );
  const { shadow, select } = mount(tools);
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Applied',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'The operation exceeded its time limit.',
  );
  select('Issue category', 'timeout');
  const list = shadow.querySelector('.list-pane')!;
  expect(list.textContent).toContain('timed-out');
  expect(list.textContent).toContain('recovered');
  expect(list.textContent).not.toContain('cancelled');
  expect(list.textContent).not.toContain('legacy');
  select('Issue category', 'unreported');
  expect(list.textContent).toContain('legacy');
  expect(list.textContent).not.toContain('timed-out');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Category not reported',
  );
  select('Activity view', 'events');
  select('Issue category', 'timeout');
  expect(list.querySelectorAll('button')).toHaveLength(2);
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'The operation exceeded its time limit.',
  );
});

test('switching evidence clears category filtering before selecting the new source', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  tools.startCapture();
  client.diagnostics.emitDiagnostic(
    'client.request.failed',
    { outcome: 'failed', errorCategory: 'timeout' },
    undefined,
    'timeout',
  );
  client.diagnostics.emitDiagnostic(
    'client.response.applied',
    { actionFailures: 0, skippedActions: 0 },
    undefined,
    'success',
  );
  tools.stopCapture();
  const { shadow, select } = mount(tools);
  select('Issue category', 'timeout');
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request timeout',
  );
  select('Evidence source', 'recording');
  expect(
    shadow.querySelector<HTMLSelectElement>('[aria-label="Issue category"]')
      ?.value,
  ).toBe('all');
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request success',
  );
});

test('matching issues survive the display limit when the same request stays selected', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  for (let index = 0; index < 30; index++)
    client.diagnostics.emitDiagnostic(
      'client.command.failed',
      {},
      undefined,
      'many-issues',
    );
  for (let index = 0; index < 32; index++)
    client.diagnostics.emitDiagnostic(
      'engine.stage.failed',
      { outcome: 'failed', errorCategory: 'timeout' },
      undefined,
      'many-issues',
    );
  const { shadow, select } = mount(tools);
  const issues = () =>
    Array.from(
      shadow.querySelectorAll('.content-pane .row-button'),
      (node) => node.textContent ?? '',
    );
  expect(issues()).toHaveLength(30);
  expect(issues().every((text) => text.includes('Category not reported'))).toBe(
    true,
  );
  select('Issue category', 'timeout');
  expect(issues()).toHaveLength(30);
  expect(issues().every((text) => text.includes('Timeout'))).toBe(true);
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    '2 more issue events',
  );
  select('Issue category', 'unreported');
  expect(issues()).toHaveLength(30);
  expect(issues().every((text) => text.includes('Category not reported'))).toBe(
    true,
  );
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'more issue events',
  );
});

test('actual Action results reach readiness and application filters without guessing legacy categories', async () => {
  const tools = collector();
  const client = new Orchestrator(connector(), {
    vessels: [vessel],
    readyTimeoutMs: 1,
  });
  const detach = tools.attach(client);
  cleanups.push(() => client.dispose(), detach);
  await client.connect();
  tools.clear();
  await client.enqueueIntent('wait for runner').result;
  const { shadow, select } = mount(tools);
  select('Issue category', 'readiness');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Skipped · Readiness',
  );
  client.commandProcessor.registerRunner(instanceId, {});
  await client.enqueueIntent('missing handler').result;
  select('Issue category', 'application');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Skipped · Application',
  );
  client.commandProcessor.registerRunner(instanceId, {
    increment: () => err(new Error('private handler failure')),
  });
  await client.enqueueIntent('handler failed').result;
  select('Issue category', 'all');
  select('Issue category', 'application');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Failed · Application',
  );
  expect(shadow.textContent).not.toContain('private handler failure');
  client.diagnostics.emitDiagnostic(
    'client.action.completed',
    { outcome: 'skipped' },
    undefined,
    'legacy',
  );
  select('Issue category', 'unreported');
  expect(shadow.querySelector('.list-pane')?.textContent).toContain('legacy');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Category not reported',
  );
});

test.each([
  'close import',
  'clear recording',
  'start recording',
] as const)('automatic source fallback resets filters and selection after %s', async (transition) => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  tools.startCapture();
  client.diagnostics.emitDiagnostic(
    'client.request.failed',
    { outcome: 'failed', errorCategory: 'timeout' },
    undefined,
    'old-recording',
  );
  tools.stopCapture();
  if (transition === 'close import') tools.importCapture(tools.exportCapture());
  client.diagnostics.emitDiagnostic(
    'client.response.applied',
    { actionFailures: 0, skippedActions: 0 },
    undefined,
    'live-success',
  );
  const { shadow, select } = mount(tools);
  select(
    'Evidence source',
    transition === 'close import' ? 'imported' : 'recording',
  );
  select('Issue category', 'timeout');
  select('Activity view', 'events');
  const search = shadow.querySelector<HTMLInputElement>(
    '[aria-label="Filter diagnostic evidence"]',
  )!;
  fireEvent.input(search, { target: { value: 'old-recording' } });
  expect(
    shadow.querySelector<HTMLSelectElement>('[aria-label="Evidence source"]')
      ?.value,
  ).toBe(transition === 'close import' ? 'imported' : 'recording');
  if (transition === 'close import') tools.closeImport();
  else if (transition === 'clear recording') tools.capture.clear();
  else tools.startCapture();
  expect(
    shadow.querySelector<HTMLSelectElement>('[aria-label="Evidence source"]')
      ?.value,
  ).toBe('live');
  expect(
    shadow.querySelector<HTMLSelectElement>('[aria-label="Issue category"]')
      ?.value,
  ).toBe('all');
  expect(
    shadow.querySelector<HTMLSelectElement>('[aria-label="Activity view"]')
      ?.value,
  ).toBe('requests');
  expect(search.value).toBe('');
  expect(shadow.querySelector('.content-pane h3')?.textContent).toBe(
    'Request live-success',
  );
});

test('partial command failures remain inspectable through the unreported category filter', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emitDiagnostic(
    'client.command.failed',
    { command: 'set_layout' },
    undefined,
    'partial-failure',
  );
  const { shadow, select } = mount(tools);
  select('Issue category', 'unreported');
  expect(shadow.querySelector('.list-pane')?.textContent).toContain(
    'partial-fa',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Category not reported',
  );
  select('Activity view', 'events');
  expect(shadow.querySelector('.list-pane button')).not.toBeNull();
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Error content was not recorded.',
  );
});

test('uncategorized connection failures stay visible with recording guidance before any request exists', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  let contentReads = 0;
  client.diagnostics.emit('client.connection.failed', { attempt: 1 }, () => {
    contentReads++;
    return { error: 'private connection error' };
  });
  const { shadow, select } = mount(tools);
  select('Activity view', 'events');
  select('Issue category', 'unreported');
  expect(shadow.querySelector('.list-pane')?.textContent).toContain(
    'Engine connection failed',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Category not reported',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Error content was not recorded.',
  );
  expect(shadow.textContent).not.toContain('private connection error');
  expect(contentReads).toBe(0);
  select('Issue category', 'transport');
  expect(shadow.querySelector('.list-pane button')).toBeNull();
});

test.each([
  'voice.session.error',
  'engine.error',
])('recording guidance for %s does not invent an outcome or promise error text', async (kind) => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emitDiagnostic(kind, { generation: 1 });
  const { shadow, select } = mount(tools);
  select('Activity view', 'events');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'Event details were not recorded.',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Failed ·',
  );
  tools.startCapture();
  client.diagnostics.emitDiagnostic(kind, { generation: 2 }, () => ({
    type: 'session.error',
    generation: 2,
  }));
  tools.stopCapture();
  select('Evidence source', 'recording');
  select('Activity view', 'events');
  const filter = shadow.querySelector<HTMLInputElement>(
    '[aria-label="Filter diagnostic evidence"]',
  )!;
  fireEvent.input(filter, { target: { value: kind } });
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'This event has no error message.',
  );
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'were not recorded',
  );
  select('Evidence source', 'live');
  client.diagnostics.emitDiagnostic(kind, { outcome: 'cancelled' });
  select('Activity view', 'events');
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'Start a recording',
  );
});

test('evidence coverage separates retained endpoints from source-wide history loss', async () => {
  const tools = createDevtools({ initialIsOpen: true, maxRequestEvents: 3 });
  cleanups.push(() => tools.dispose());
  const { client } = await clientFor(tools);
  tools.clear();
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'partial',
  );
  const { shadow } = mount(tools);
  const content = () =>
    shadow.querySelector('.content-pane')?.textContent ?? '';
  expect(content()).toContain('No final client outcome is available');
  expect(content()).not.toContain('Start and outcome retained');
  client.diagnostics.emitDiagnostic(
    'client.response.applied',
    { actionFailures: 0, skippedActions: 0 },
    undefined,
    'partial',
  );
  expect(content()).toContain('Start and outcome retained');
  client.diagnostics.emitDiagnostic(
    'engine.stage.completed',
    { stage: 'plan', outcome: 'succeeded' },
    undefined,
    'partial',
  );
  client.diagnostics.emitDiagnostic(
    'engine.request.completed',
    { outcome: 'succeeded' },
    undefined,
    'partial',
  );
  expect(content()).toContain(
    'Partial evidence: the request start is not retained.',
  );
  expect(content()).toContain(
    '1 event dropped or evicted across this evidence source',
  );
  expect(content()).not.toContain('Start and outcome retained');
  expect(content()).toContain('does not identify which requests lost events');
});

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
      (node) => (node.getAttribute('aria-label') ?? node.textContent) === name,
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
  expect(shadow.textContent).toContain('Request activity');
  expect(shadow.querySelector('.content-pane')?.textContent).toContain(
    'The client finished applying the response commands',
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
  const raw = shadow.querySelector<HTMLPreElement>(
    '[aria-label="JSON evidence"] .json-raw',
  );
  const tree = shadow.querySelector<HTMLElement>(
    '[aria-label="JSON evidence"] .json-tree',
  );
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
  click('Open Maelstrom Devtools');
  expect(
    shadow
      .querySelector('[aria-label="JSON evidence"] .json-raw')
      ?.hasAttribute('hidden'),
  ).toBe(false);
  tools.capture.addRedactor((value) =>
    JSON.parse(JSON.stringify(value).replaceAll('quoted', 'masked')),
  );
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).not.toContain('quoted');
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-tree')
      ?.textContent,
  ).not.toContain('quoted');
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

test('recording redaction clears comparison identities that the new policy removes', async () => {
  const tools = collector();
  const { client } = await clientFor(tools);
  tools.startCapture();
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'private-request-id',
  );
  tools.stopCapture();
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'recording');
  click('Compare request');
  expect(
    shadow.querySelector('[aria-label="Request comparison"]')?.textContent,
  ).toContain('private-request-id');
  tools.capture.addRedactor((value) =>
    JSON.parse(
      JSON.stringify(value).replaceAll(
        'private-request-id',
        'masked-request-id',
      ),
    ),
  );
  expect(
    shadow.querySelector('[aria-label="Request comparison"]') === null,
  ).toBe(true);
  expect(shadow.querySelector('.content-pane')?.textContent).not.toContain(
    'private-request-id',
  );
  expect(tools.capture.export()).not.toContain('private-request-id');
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
