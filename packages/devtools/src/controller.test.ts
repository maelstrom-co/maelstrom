import { afterEach, expect, test } from 'bun:test';
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
import {
  ActionName,
  defineVessel,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  ok,
  SessionId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { DiagnosticCapture } from './capture.js';
import { createDevtools } from './controller.js';
import {
  groupRequests,
  inspectState,
  panelEvents,
  recordingEvidence,
} from './panel-model.js';

const instanceId = InstanceId('inspector-instance');
const vessel = defineVessel({
  id: 'inspector-vessel',
  name: 'Inspector fixture',
  description: 'A fixture whose action result must be observable.',
  defaultVariant: 'main',
  variants: {
    main: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'show', description: 'Show fixture' }],
    },
  },
});
function response(requestId = MessageId('request')): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId,
    rationale: 'fixture',
    userMessage: 'done',
    executionPlan: [{ instanceId, action: ActionName('show') }],
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
  };
}
function connector(
  process: EngineConnector['process'] = async (message) => response(message.id),
): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    process,
    subscribe: () => () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
  };
}
const releases: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0).reverse()) await release();
});

test('live and recorded inspection keep hidden retained Instances after a layout command', async () => {
  const hiddenId = InstanceId('hidden-instance');
  const layout = response().layout;
  if (layout.type !== 'tiling') throw new Error('Expected a tiling fixture');
  const completeLayout = {
    ...layout,
    instances: [
      ...layout.instances,
      {
        instanceId: hiddenId,
        vesselId: VesselId(vessel.id),
        variant: VariantName('main'),
      },
    ],
  };
  const { tools, client } = setup(
    {},
    connector(async (message) => ({
      ...response(message.id),
      layout: completeLayout,
      executionPlan: [],
    })),
  );
  client.commandProcessor.setLayout(completeLayout);
  await client.commandProcessor.waitForIdle();
  const appId = tools.getSnapshot().sessions[0].id;
  expect(
    client.getStructuralSnapshot().instances.map((item) => item.instanceId),
  ).toEqual([instanceId]);
  const visibility = (value: unknown) =>
    inspectState(value).instances.map((item) => [
      item.instanceId,
      item.visible,
    ]);
  expect(visibility(tools.inspect(appId))).toEqual([
    [instanceId, true],
    [hiddenId, false],
  ]);
  tools.startCapture(appId);
  const recorded = () =>
    recordingEvidence(JSON.parse(tools.exportCapture())).apps[0].inspection;
  expect(visibility(recorded())).toEqual([
    [instanceId, true],
    [hiddenId, false],
  ]);
  await client.connect();
  await client.processIntent('Keep the hidden Instance available for remount');
  await client.commandProcessor.waitForIdle();
  tools.stopCapture();
  expect(visibility(recorded())).toEqual([
    [instanceId, true],
    [hiddenId, false],
  ]);
});

test('highlight controls are scoped, idempotent, and revoked before a client detaches', async () => {
  const { tools, client, detach } = setup();
  const other = new Orchestrator(connector());
  const detachOther = tools.attach(other);
  releases.push(() => other.dispose(), detachOther);
  const firstId = tools.getSnapshot().sessions[0].id,
    secondId = tools.getSnapshot().sessions[1].id;
  const first: unknown[] = [],
    second: unknown[] = [];
  const releaseFirst = client.diagnostics.observeControls((event) => {
    if (event.kind === 'devtools.instance.changed') first.push(event.metadata);
  });
  const releaseSecond = other.diagnostics.observeControls((event) => {
    if (event.kind === 'devtools.instance.changed') second.push(event.metadata);
  });
  releases.push(releaseFirst, releaseSecond);
  tools.setHighlightedInstance?.(firstId, 'shared');
  tools.setHighlightedInstance?.(firstId, 'shared');
  expect(first).toEqual([{ enabled: true, instanceId: 'shared' }]);
  expect(second).toEqual([]);
  tools.setHighlightedInstance?.(secondId, 'shared');
  expect(first.at(-1)).toEqual({ enabled: false });
  expect(second.at(-1)).toEqual({ enabled: true, instanceId: 'shared' });
  detachOther();
  const late: unknown[] = [];
  releases.push(
    other.diagnostics.observeControls((event) => {
      if (event.kind === 'devtools.instance.changed') late.push(event.metadata);
    }),
  );
  expect(late).toEqual([{ enabled: false }]);
  tools.setHighlightedInstance?.(firstId, 'shared');
  detach();
  expect(first.at(-1)).toEqual({ enabled: false });
});

test('a reentrant highlight change keeps the latest selection instead of restoring an earlier target', () => {
  const { tools, client } = setup();
  const other = new Orchestrator(connector());
  const detachOther = tools.attach(other);
  releases.push(() => other.dispose(), detachOther);
  const firstId = tools.getSnapshot().sessions[0].id,
    secondId = tools.getSnapshot().sessions[1].id;
  tools.setHighlightedInstance?.(firstId, 'first');
  let reenter = true;
  releases.push(
    client.diagnostics.observeControls((event) => {
      if (
        event.kind === 'devtools.instance.changed' &&
        event.metadata.enabled === false &&
        reenter
      ) {
        reenter = false;
        tools.setHighlightedInstance?.(firstId, 'latest');
      }
    }),
  );
  tools.setHighlightedInstance?.(secondId, 'earlier');
  const states: unknown[] = [];
  releases.push(
    client.diagnostics.observeControls((event) => {
      if (event.kind === 'devtools.instance.changed')
        states.push(event.metadata);
    }),
  );
  expect(states).toEqual([{ enabled: true, instanceId: 'latest' }]);
});
function setup(
  options: Parameters<typeof createDevtools>[0] = {},
  conn = connector(),
) {
  const tools = createDevtools(options);
  const client = new Orchestrator(conn, {
    sessionId: SessionId('diagnostic-session'),
    vessels: [vessel],
    readyTimeoutMs: 1,
  });
  const detach = tools.attach(client);
  releases.push(
    () => client.dispose(),
    () => tools.dispose(),
    detach,
  );
  return { tools, client, detach };
}

test.each([
  'projected',
  'removed',
] as const)('application redaction removes retained session identity after detachment: %s', (policy) => {
  const { tools, detach } = setup({
    redact:
      policy === 'removed'
        ? () => null
        : (value) =>
            JSON.parse(
              JSON.stringify(value).replaceAll(
                'diagnostic-session',
                '[REDACTED]',
              ),
            ),
  });
  expect(tools.getSnapshot().sessions[0]?.sessionId).toBe('[REDACTED]');
  detach();
  expect(tools.getSnapshot().sessions[0]?.active).toBe(false);
  expect(JSON.stringify(tools.getSnapshot())).not.toContain(
    'diagnostic-session',
  );
});

test('observes startup and correlates applied layout and successful Actions without recording intent content', async () => {
  const { tools, client } = setup();
  client.commandProcessor.registerRunner(instanceId, {
    show: () => ok(undefined),
  });
  await client.connect();
  await client.processIntent('private intent');
  await client.commandProcessor.waitForIdle();
  const events = tools.getSnapshot().activity;
  const request = events.find((e) => e.kind === 'client.request.started');
  expect(request).toBeDefined();
  expect(
    events.find((e) => e.kind === 'client.action.completed'),
  ).toMatchObject({
    requestId: request?.requestId,
    metadata: { outcome: 'succeeded' },
  });
  expect(
    events.find(
      (e) =>
        e.kind === 'client.command.completed' &&
        e.metadata.command === 'set_layout',
    )?.requestId,
  ).toBe(request?.requestId);
  expect(events.some((e) => e.kind === 'client.connection.changed')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('private intent');
  expect(tools.capture.getSnapshot().count).toBe(0);
});

test('readiness skips remain visible instead of appearing as successful Actions', async () => {
  const { tools, client } = setup();
  await client.connect();
  await client.processIntent('show fixture');
  await client.commandProcessor.waitForIdle();
  expect(
    tools
      .getSnapshot()
      .activity.find((e) => e.kind === 'client.action.completed')?.metadata
      .outcome,
  ).toBe('skipped');
});

test('records correlated failures and discards responses from superseded connectors', async () => {
  let finish: (response: MaelstromResponse) => void = () => {};
  const { tools, client } = setup(
    {},
    connector(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  await client.connect();
  const pending = client.processIntent('show fixture');
  const started = tools
    .getSnapshot()
    .activity.find((e) => e.kind === 'client.request.started');
  client.setConnector(connector());
  finish(response());
  await expect(pending).rejects.toThrow();
  expect(
    tools
      .getSnapshot()
      .activity.find((e) => e.kind === 'client.response.discarded'),
  ).toMatchObject({
    requestId: started?.requestId,
    metadata: { reason: 'superseded' },
  });
  expect(
    tools
      .getSnapshot()
      .activity.some((e) => e.kind === 'client.command.started'),
  ).toBe(false);
});

test('retains evidence after remount and releases all collection sources on detachment', () => {
  let serverObservers = 0;
  const conn = Object.assign(connector(), {
    subscribeDiagnostics: () => {
      serverObservers++;
      return () => {
        serverObservers--;
      };
    },
    setDiagnosticContent: () => {},
  });
  const { tools, client, detach } = setup({}, conn);
  tools.startCapture();
  tools.capture.setOutcome('reproduce reconnect');
  tools.stopCapture();
  detach();
  expect(client.diagnostics.observed).toBe(false);
  expect(serverObservers).toBe(0);
  expect(tools.getSnapshot().sessions[0]?.active).toBe(false);
  expect(tools.capture.getSnapshot().outcome).toBe('reproduce reconnect');
  const replacement = new Orchestrator(connector(), {
    sessionId: SessionId('replacement'),
  });
  releases.push(() => replacement.dispose(), tools.attach(replacement));
  expect(tools.getSnapshot().sessions).toHaveLength(2);
  expect(tools.capture.getSnapshot().outcome).toBe('reproduce reconnect');
});

test('redacts before retention and imports evidence without executing client operations', () => {
  const { tools, client } = setup({
    redact: (value) =>
      JSON.parse(
        JSON.stringify(value).replaceAll('account-secret', '[APP REDACTED]'),
      ),
  });
  tools.startCapture();
  client.diagnostics.emit('test.content', {}, () => ({
    text: 'account-secret',
    apiKey: 'private-key',
  }));
  tools.stopCapture();
  const exported = tools.exportCapture();
  expect(exported).not.toContain('account-secret');
  expect(exported).not.toContain('private-key');
  tools.importCapture(exported);
  expect(tools.getSnapshot().imported).not.toBeNull();
  expect(client.commandProcessor.queueLength).toBe(0);
  expect(() => tools.importCapture('{"schemaVersion":999}')).toThrow();
  expect(() => tools.importCapture('x'.repeat(3_000_000))).toThrow();
});

test('bounds metadata and explicit content independently, retaining dropped-event counts', () => {
  const { tools, client } = setup({
    maxActivityEvents: 2,
    capture: { maxEvents: 3, maxCharacters: 10000, maxStringCharacters: 32 },
  });
  tools.startCapture();
  for (let i = 0; i < 10; i++)
    client.diagnostics.emit('test.bounded', { index: i }, () => ({
      text: 'x'.repeat(200),
    }));
  tools.stopCapture();
  expect(tools.getSnapshot().activity).toHaveLength(2);
  expect(tools.capture.getSnapshot().count).toBe(3);
  expect(tools.capture.getSnapshot().dropped).toBeGreaterThan(0);
});

test('unrelated activity cannot erase request evidence and request eviction removes whole traces', () => {
  const { tools, client } = setup({
    maxActivityEvents: 2,
    maxRequestEvents: 5,
  });
  let contentReads = 0;
  const emit = (kind: string, requestId: string) =>
    client.diagnostics.emit(
      kind,
      {},
      () => {
        contentReads++;
        return 'private request content';
      },
      requestId,
    );
  emit('client.request.started', 'first');
  emit('client.request.started', 'second');
  emit('client.response.applied', 'first');
  emit('client.response.applied', 'second');
  const retained = tools.getSnapshot().requestActivity;
  for (let i = 0; i < 10; i++) client.diagnostics.emit('voice.session');
  expect(tools.getSnapshot().activity).toHaveLength(2);
  expect(tools.getSnapshot().requestActivity).toBe(retained);
  emit('client.request.started', 'third');
  emit('client.response.applied', 'third');
  const state = tools.getSnapshot();
  expect(state.requestActivity).toHaveLength(4);
  expect(state.droppedRequestEvents).toBe(2);
  const requests = groupRequests(panelEvents(state.requestActivity));
  expect(requests.map((request) => request.requestId)).toEqual([
    'third',
    'second',
  ]);
  expect(requests.every((request) => !request.missingStart)).toBe(true);
  expect(contentReads).toBe(0);
  expect(JSON.stringify(state)).not.toContain('private request content');
  tools.clear();
  expect(tools.getSnapshot().requestActivity).toEqual([]);
  expect(tools.getSnapshot().droppedRequestEvents).toBe(0);
});

test('a single oversized request stays bounded and reports its missing start', () => {
  const { tools, client } = setup({ maxRequestEvents: 3 });
  client.diagnostics.emit('client.request.started', {}, undefined, 'large');
  for (let i = 0; i < 5; i++)
    client.diagnostics.emit('engine.planner.started', {}, undefined, 'large');
  client.diagnostics.emit('client.response.applied', {}, undefined, 'large');
  const state = tools.getSnapshot();
  expect(state.requestActivity).toHaveLength(3);
  expect(state.droppedRequestEvents).toBe(4);
  const [request] = groupRequests(panelEvents(state.requestActivity));
  expect(request.missingStart).toBe(true);
  expect(request.status).toBe('applied');
});

test('disabled tools never attach or evaluate lazy content', () => {
  const { tools, client } = setup({ enabled: false });
  let called = false;
  client.diagnostics.emit('test.disabled', {}, () => {
    called = true;
    return 'secret';
  });
  tools.startCapture();
  expect(client.diagnostics.observed).toBe(false);
  expect(called).toBe(false);
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test.each([
  1, 2,
])('legacy provider wire recordings remain read-only after producer migration: schema %s', (version) => {
  const tools = createDevtools();
  const capture = {
    schemaVersion: 1,
    active: false,
    metadata: {},
    events: [
      {
        kind: 'live_wire',
        at: 1,
        direction: 'received',
        type: 'response.event',
        peerId: 'legacy-peer',
        delegationId: 'legacy-delegation',
      },
    ],
  };
  tools.importCapture(
    JSON.stringify(version === 1 ? capture : { schemaVersion: 2, capture }),
  );
  expect(tools.getSnapshot().imported).toMatchObject({
    capture: {
      events: [
        {
          kind: 'live_wire',
          peerId: 'legacy-peer',
          delegationId: 'legacy-delegation',
        },
      ],
    },
  });
  expect(tools.capture.getSnapshot().active).toBe(false);
  tools.dispose();
});

test('terminal provider generations retain separate connection evidence', () => {
  const { tools, client } = setup();
  client.diagnostics.emit('voice.transport', {
    providerInstanceId: 'provider',
    providerGeneration: 1,
    state: 'closed',
  });
  client.diagnostics.emit('voice.transport', {
    providerInstanceId: 'provider',
    providerGeneration: 2,
    state: 'error',
  });
  expect(
    tools
      .getSnapshot()
      .transportHistory.map((event) => event.metadata.providerGeneration),
  ).toEqual([1, 2]);
});

test('explicit capture excludes pre-start content and retains redacted notes after credentials disappear', () => {
  let key: string | null = 'known-private-key';
  const capture = new DiagnosticCapture(() => key);
  capture.record('before', { text: 'earlier' });
  capture.start('custom', 'session', 'provider');
  capture.setOutcome('known-private-key should not appear');
  key = null;
  capture.stop();
  expect(capture.export()).not.toContain('known-private-key');
  expect(capture.export()).not.toContain('earlier');
  expect(capture.getSnapshot().outcome).toContain('[REDACTED]');
});

test.each([
  {
    name: 'metadata without diagnostic identity',
    fields: { metadata: { component: 'calendar' } },
  },
  {
    name: 'application identity and nested metadata',
    fields: {
      id: 'calendar-event',
      sessionId: 'application-session',
      metadata: { component: 'calendar', selection: { view: 'week' } },
    },
  },
])('custom capture fields reopen without being mistaken for diagnostic envelopes: $name', ({
  fields,
}) => {
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  tools.startCapture();
  tools.capture.record('app.event', fields);
  tools.stopCapture();

  for (const exported of [tools.exportCapture(), tools.capture.export()]) {
    tools.importCapture(exported);
    const imported = tools.getSnapshot().imported as {
      capture: { events: unknown[] };
    };
    expect(imported.capture.events).toContainEqual(
      expect.objectContaining({ kind: 'app.event', ...fields }),
    );
    expect(tools.capture.getSnapshot().active).toBe(false);
  }
});

test('invalid event containers cannot replace an imported custom recording', () => {
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  tools.startCapture();
  tools.capture.record('app.event', { metadata: { component: 'calendar' } });
  tools.stopCapture();
  tools.importCapture(tools.exportCapture());
  const retained = tools.getSnapshot().imported;

  for (const events of [[null], ['not an event'], { kind: 'app.event' }]) {
    expect(() =>
      tools.importCapture(
        JSON.stringify({
          schemaVersion: 2,
          capture: { schemaVersion: 1, events },
        }),
      ),
    ).toThrow('Unsupported or invalid Maelstrom capture.');
    expect(tools.getSnapshot().imported).toBe(retained);
  }
});

test('a full retained capture exports valid events and reopens without truncating event envelopes', () => {
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  tools.startCapture();
  for (let index = 0; index < 999; index++)
    tools.capture.record('fixture', {
      id: String(index),
      sessionId: 's',
      metadata: { clientId: 'c', index },
      content: { x: 'ok', y: 'ok', z: 'ok' },
    });
  tools.stopCapture();
  const exported = tools.exportCapture();
  const parsed = JSON.parse(exported);
  expect(parsed.capture.events).toHaveLength(1000);
  expect(
    parsed.capture.events.every((event: unknown) => typeof event === 'object'),
  ).toBe(true);
  expect(() => tools.importCapture(exported)).not.toThrow();
  expect(
    (tools.getSnapshot().imported as typeof parsed).capture.events,
  ).toHaveLength(1000);
});

test('Clear removes old lifetimes and evidence while keeping active collection attached', () => {
  const { tools, client, detach } = setup();
  detach();
  const other = new Orchestrator(connector(), { sessionId: SessionId('live') });
  releases.push(() => other.dispose(), tools.attach(other));
  tools.startCapture();
  tools.stopCapture();
  tools.clear();
  expect(tools.getSnapshot().sessions).toHaveLength(1);
  expect(tools.getSnapshot().sessions[0]?.active).toBe(true);
  expect(tools.getSnapshot().activity).toHaveLength(0);
  expect(client.diagnostics.observed).toBe(false);
  expect(other.diagnostics.observed).toBe(true);
});

test('disposal records a correlated terminal outcome before pending transport work settles', async () => {
  let finish: (value: MaelstromResponse) => void = () => {};
  const { tools, client } = setup(
    {},
    connector(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  await client.connect();
  const pending = client.processIntent('pending');
  const request = tools
    .getSnapshot()
    .activity.find((event) => event.kind === 'client.request.started');
  await client.dispose();
  expect(
    groupRequests(panelEvents(tools.getSnapshot().activity))[0]?.status,
  ).toBe('cancelled');
  finish(response());
  await pending;
  expect(
    tools
      .getSnapshot()
      .activity.find((event) => event.kind === 'client.request.failed'),
  ).toMatchObject({
    requestId: request?.requestId,
    metadata: { reason: 'disposed', outcome: 'cancelled' },
  });
  expect(
    groupRequests(panelEvents(tools.getSnapshot().activity))[0]?.status,
  ).toBe('cancelled');
});

test('automatic snapshots retain structural registry facts while explicit inspection reads full definitions', () => {
  const { tools } = setup();
  const snapshot = tools.getSnapshot();
  expect(JSON.stringify(snapshot)).not.toContain(vessel.description);
  expect(
    JSON.stringify(tools.inspect(snapshot.sessions[0]?.id ?? '')),
  ).toContain(vessel.description);
});

test('failed requests retain their identity and redacted evidence without changing the caller error', async () => {
  const error = new Error('known failure');
  const { tools, client } = setup(
    {},
    connector(async () => {
      throw error;
    }),
  );
  await client.connect();
  tools.startCapture();
  await expect(client.processIntent('failed intent')).rejects.toBe(error);
  tools.stopCapture();
  const failed = tools
    .getSnapshot()
    .activity.find((event) => event.kind === 'client.request.failed');
  const started = tools
    .getSnapshot()
    .activity.find((event) => event.kind === 'client.request.started');
  expect(failed?.requestId).toBe(started?.requestId);
  expect(tools.exportCapture()).toContain('known failure');
});

test('application redaction composes with an existing capture store and its retained notes', () => {
  const capture = new DiagnosticCapture();
  capture.start('fixture', 'session', 'provider');
  capture.setOutcome('account-secret');
  capture.record('fixture', { text: 'account-secret' });
  capture.stop();
  const tools = createDevtools({
    capture,
    redact: (value) =>
      JSON.parse(
        JSON.stringify(value).replaceAll('account-secret', '[APP REDACTED]'),
      ),
  });
  releases.push(() => tools.dispose());
  expect(capture.getSnapshot().outcome).toBe('[APP REDACTED]');
  expect(tools.exportCapture()).not.toContain('account-secret');
  tools.clear();
  tools.startCapture();
  capture.setOutcome('account-secret');
  tools.stopCapture();
  expect(capture.getSnapshot().outcome).toBe('[APP REDACTED]');
});

test('adding redaction cannot expand retained evidence beyond the configured capture budget', () => {
  const capture = new DiagnosticCapture(() => null, {
    maxCharacters: 600,
  });
  capture.start('fixture', 'session', 'provider');
  for (let index = 0; index < 3; index++)
    capture.record('fixture', { text: 'short' });
  capture.addRedactor((value) =>
    JSON.parse(JSON.stringify(value).replaceAll('short', 'x'.repeat(300))),
  );
  const events = JSON.parse(capture.export()).events;
  expect(
    events.reduce(
      (size: number, event: unknown) => size + JSON.stringify(event).length,
      0,
    ),
  ).toBeLessThanOrEqual(600);
  expect(capture.getSnapshot().count).toBe(events.length);
  expect(capture.getSnapshot().dropped).toBeGreaterThan(0);
});

test('capture forwarding follows both transport changes and new Provider lifetimes', () => {
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  const first = new Orchestrator(connector());
  releases.push(() => first.dispose());
  const detach = tools.attach(first);
  releases.push(detach);
  tools.startCapture();
  const content: boolean[] = [];
  const diagnostic = Object.assign(connector(), {
    subscribeDiagnostics: () => () => {},
    setDiagnosticContent: (enabled: boolean) => {
      content.push(enabled);
    },
  });
  first.setConnector(diagnostic);
  expect(content.at(-1)).toBe(true);
  detach();
  const replacement = new Orchestrator(diagnostic);
  releases.push(() => replacement.dispose(), tools.attach(replacement));
  expect(content.at(-1)).toBe(true);
  tools.stopCapture();
  expect(content.at(-1)).toBe(false);
});

test.each([
  'all',
  'selected',
] as const)('one collector cannot revoke another recording permission: %s scope', (scope) => {
  let contentEnabled = false;
  const conn = Object.assign(connector(), {
    subscribeDiagnostics: () => () => {},
    setDiagnosticContent: (enabled: boolean) => {
      contentEnabled = enabled;
    },
  });
  const { tools: first, client } = setup({}, conn);
  const second = createDevtools();
  releases.push(() => second.dispose());
  const start = (tools: ReturnType<typeof createDevtools>) =>
    tools.startCapture(
      scope === 'selected'
        ? tools.getSnapshot().sessions.at(-1)?.id
        : undefined,
    );
  start(first);
  expect(contentEnabled).toBe(true);
  const detachSecond = second.attach(client);
  releases.push(detachSecond);
  expect(contentEnabled).toBe(true);
  start(second);
  second.stopCapture();
  expect(first.capture.getSnapshot().active).toBe(true);
  expect(contentEnabled).toBe(true);
  start(second);
  first.stopCapture();
  expect(second.capture.getSnapshot().active).toBe(true);
  expect(contentEnabled).toBe(true);
  start(first);
  detachSecond();
  expect(contentEnabled).toBe(true);
  releases.push(second.attach(client));
  first.stopCapture();
  expect(contentEnabled).toBe(scope === 'all');
  start(first);
  start(second);
  second.dispose();
  expect(contentEnabled).toBe(true);
  first.stopCapture();
  expect(contentEnabled).toBe(false);
});

test('stopping recording during control delivery cannot restore superseded forwarding', () => {
  let contentEnabled = false;
  const conn = Object.assign(connector(), {
    subscribeDiagnostics: () => () => {},
    setDiagnosticContent: (enabled: boolean) => {
      contentEnabled = enabled;
    },
  });
  const client = new Orchestrator(conn);
  const tools = createDevtools();
  const releaseControl = client.diagnostics.observeControls((event) => {
    if (
      event.kind === 'devtools.capture.changed' &&
      event.metadata.enabled === true
    )
      tools.stopCapture();
  });
  releases.push(
    () => client.dispose(),
    () => tools.dispose(),
    releaseControl,
    tools.attach(client),
  );
  tools.startCapture();
  expect(tools.capture.getSnapshot().active).toBe(false);
  expect(contentEnabled).toBe(false);
  const replayed: unknown[] = [];
  releases.push(
    client.diagnostics.observeControls((event) => {
      if (event.kind === 'devtools.capture.changed')
        replayed.push(event.metadata.enabled);
    }),
  );
  expect(replayed).toEqual([false]);
});

test.each([
  'all',
  'selected',
] as const)('a reentrant recording stop revokes permission on every attached client: %s', (scope) => {
  const forwarding = [false, false];
  const conn = (index: number) =>
    Object.assign(connector(), {
      subscribeDiagnostics: () => () => {},
      setDiagnosticContent: (enabled: boolean) => {
        forwarding[index] = enabled;
      },
    });
  const { tools, client } = setup({}, conn(0));
  const other = new Orchestrator(conn(1));
  releases.push(() => other.dispose(), tools.attach(other));
  releases.push(
    client.diagnostics.observeControls((event) => {
      if (
        event.kind === 'devtools.capture.changed' &&
        event.metadata.enabled === true
      )
        tools.stopCapture();
    }),
  );
  tools.startCapture(
    scope === 'selected' ? tools.getSnapshot().sessions[0]?.id : undefined,
  );
  expect(tools.capture.getSnapshot().active).toBe(false);
  expect(forwarding).toEqual([false, false]);
});

test.each([
  ['selected', 'existing'],
  ['selected', 'later'],
  ['all', 'existing'],
  ['all', 'later'],
] as const)('detaching a %s capture revokes content permission for %s observers', (scope, observer) => {
  let contentEnabled = false;
  const conn = Object.assign(connector(), {
    subscribeDiagnostics: () => () => {},
    setDiagnosticContent: (enabled: boolean) => {
      contentEnabled = enabled;
    },
  });
  const { tools, client, detach } = setup({}, conn);
  const other = new Orchestrator(connector());
  releases.push(() => other.dispose(), tools.attach(other));
  if (observer === 'existing')
    releases.push(client.diagnostics.subscribe(() => {}));
  const id = tools.getSnapshot().sessions[0]?.id;
  expect(id).toBeDefined();
  tools.startCapture(scope === 'selected' ? id : undefined);
  expect(contentEnabled).toBe(true);

  detach();
  if (observer === 'later')
    releases.push(client.diagnostics.subscribe(() => {}));

  expect(contentEnabled).toBe(false);
  const replayed: boolean[] = [];
  releases.push(
    client.diagnostics.observeControls((event) => {
      if (event.kind === 'devtools.capture.changed')
        replayed.push(event.metadata.enabled === true);
    }),
  );
  expect(replayed.at(-1)).toBe(false);
  expect(tools.capture.getSnapshot().active).toBe(scope === 'all');
  other.diagnostics.emit('client.remaining');
  expect(
    JSON.parse(tools.exportCapture()).capture.events.some(
      (event: { kind: string }) => event.kind === 'client.remaining',
    ),
  ).toBe(scope === 'all');
});

test('optional connector failures cannot abort replacement or duplicate later observations', async () => {
  const broken = Object.assign(connector(), {
    subscribeDiagnostics: () => () => {
      throw new Error('unsubscribe failed');
    },
    setDiagnosticContent: () => {},
  });
  const { tools, client, detach } = setup({}, broken);
  detach();
  releases.push(tools.attach(client));
  client.commandProcessor.setLayout({
    type: 'tiling',
    tree: [],
    instances: [],
  });
  await client.commandProcessor.waitForIdle();
  expect(
    tools
      .getSnapshot()
      .activity.filter((event) => event.kind === 'client.command.queued'),
  ).toHaveLength(1);
  const failed = Object.assign(connector(), {
    subscribeDiagnostics: () => {
      throw new Error('optional subscribe failed');
    },
  });
  expect(() => client.setConnector(failed)).not.toThrow();
  expect(
    tools
      .getSnapshot()
      .activity.some(
        (event) => event.kind === 'client.diagnostics.unavailable',
      ),
  ).toBe(true);
});

test('a removed capture target is rejected before it can erase retained evidence', () => {
  const { tools, detach } = setup();
  const id = tools.getSnapshot().sessions[0]?.id ?? '';
  tools.startCapture(id);
  tools.capture.setOutcome('retained');
  tools.stopCapture();
  detach();
  expect(() => tools.startCapture(id)).toThrow('active Provider');
  expect(tools.capture.getSnapshot().outcome).toBe('retained');
});

test('All Providers captures identify the collection instead of claiming the first lifetime', () => {
  const { tools, client } = setup();
  const other = new Orchestrator(connector(), {
    sessionId: SessionId('other-session'),
  });
  releases.push(() => other.dispose(), tools.attach(other));
  tools.startCapture();
  client.diagnostics.emit('client.first');
  other.diagnostics.emit('client.second');
  tools.stopCapture();
  const capture = JSON.parse(tools.exportCapture()).capture;
  expect(capture.metadata).toMatchObject({ scope: 'all-providers' });
  expect(capture.metadata.sessionId).toBeUndefined();
  expect(capture.metadata.providerInstanceId).toBeUndefined();
  expect(
    capture.events.filter((event: { kind: string }) =>
      ['client.first', 'client.second'].includes(event.kind),
    ),
  ).toHaveLength(2);
  const selected = tools.getSnapshot().sessions[0]!;
  tools.startCapture(selected.id);
  other.diagnostics.emit('client.excluded');
  tools.stopCapture();
  const single = JSON.parse(tools.exportCapture()).capture;
  expect(single.metadata).toMatchObject({
    scope: 'provider',
    sessionId: selected.sessionId,
    providerInstanceId: selected.id,
  });
  expect(
    single.events.some(
      (event: { kind: string }) => event.kind === 'client.excluded',
    ),
  ).toBe(false);
});

test('a full legacy capture reopens despite JSON formatting overhead', () => {
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  tools.startCapture();
  const content = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [`k${i}`, 'shorttext']),
  );
  for (let index = 0; index < 999; index++)
    tools.capture.record('fixture', { content });
  tools.stopCapture();
  const legacy = tools.capture.export();
  expect(legacy.length).toBeGreaterThan(2_262_144);
  expect(() => tools.importCapture(legacy)).not.toThrow();
  expect(
    (tools.getSnapshot().imported as { capture: { events: unknown[] } }).capture
      .events,
  ).toHaveLength(1000);
  expect(() =>
    tools.importCapture(
      JSON.stringify({
        schemaVersion: 1,
        events: [{ content: 'x'.repeat(2_300_000) }],
      }),
    ),
  ).toThrow('import size');
  expect(() =>
    tools.importCapture(
      JSON.stringify({
        schemaVersion: 1,
        events: [{ content: '🌊'.repeat(1_150_000) }],
      }),
    ),
  ).toThrow('import size');
});

test('the import allowance includes bounded metadata separately from the event budget', () => {
  const fields = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [`field${i}`, 'x'.repeat(16384)]),
  );
  const tools = createDevtools({ capture: { metadata: () => fields } });
  releases.push(() => tools.dispose());
  tools.startCapture();
  tools.capture.record('fixture', { content: fields });
  tools.stopCapture();
  const exported = tools.exportCapture();
  expect(exported.length).toBeGreaterThan(2_262_144);
  expect(() => tools.importCapture(exported)).not.toThrow();
  expect(
    (tools.getSnapshot().imported as { capture: { events: unknown[] } }).capture
      .events,
  ).toHaveLength(3);
});

test('application redaction cannot expand imported evidence beyond its event budget', () => {
  const tools = createDevtools({
    capture: { maxCharacters: 1000, maxStringCharacters: 1000 },
    redact: (value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 'fixture'
      )
        return { ...value, content: 'r'.repeat(1000) };
      return value;
    },
  });
  releases.push(() => tools.dispose());
  expect(() =>
    tools.importCapture(
      JSON.stringify({ schemaVersion: 1, events: [{ kind: 'fixture' }] }),
    ),
  ).toThrow('import size');
  expect(tools.getSnapshot().imported).toBeNull();
});
