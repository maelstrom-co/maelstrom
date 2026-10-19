import { afterEach, expect, test } from 'bun:test';
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
import {
  createDevtools,
  type Devtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';
import { SessionId } from '@maelstrom-co/protocol';
import { fireEvent, waitFor } from '@testing-library/react';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function event(
  id: string,
  requestId: string | undefined,
  kind: string,
  metadata: Record<string, unknown> = {},
  content?: unknown,
) {
  return {
    id,
    sessionId: 'session',
    requestId,
    kind,
    metadata: { clientId: 'app', ...metadata },
    content,
  };
}

function mount(tools: Devtools) {
  const unmount = mountDevtools(tools);
  cleanups.push(() => tools.dispose(), unmount);
  const shadow = document.querySelector('[data-maelstrom-devtools]')!
    .shadowRoot!;
  const click = (name: string, scope: ParentNode = shadow) => {
    const target = Array.from(scope.querySelectorAll('button')).find(
      (node) => (node.getAttribute('aria-label') ?? node.textContent) === name,
    );
    if (!target) throw new Error(`Missing button ${name}`);
    fireEvent.click(target);
  };
  const select = (name: string, value: string) =>
    fireEvent.change(shadow.querySelector(`select[aria-label="${name}"]`)!, {
      target: { value },
    });
  const pick = (id: string) =>
    fireEvent.click(
      Array.from(shadow.querySelectorAll('.list-pane button')).find((node) =>
        node.textContent?.includes(`Request ${id}`),
      )!,
    );
  const side = (name: 'A' | 'B') =>
    shadow.querySelector(`[aria-label="Comparison ${name}"]`)!;
  return { shadow, click, select, pick, side, unmount };
}

function recording(events: object[]) {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({ schemaVersion: 2, capture: { schemaVersion: 1, events } }),
  );
  const panel = mount(tools);
  panel.select('Evidence source', 'imported');
  return { tools, ...panel };
}

function attach(tools: Devtools) {
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    subscribe: () => () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
    process: async () => {
      throw new Error('This test only observes client diagnostics');
    },
  };
  const client = new Orchestrator(connector, {
    sessionId: SessionId('shared'),
    vessels: [],
  });
  const detach = tools.attach(client);
  cleanups.push(() => client.dispose(), detach);
  return { client, detach };
}

test('both selected comparison events expose their full JSON at the same time', () => {
  const { shadow, click, pick, side } = recording(
    ['a', 'b'].flatMap((id) => [
      event(
        `${id}-first`,
        id,
        'engine.stage.completed',
        { stage: 'plan', outcome: 'succeeded' },
        { marker: `first-${id}` },
      ),
      event(
        `${id}-second`,
        id,
        'client.action.completed',
        { action: 'open', instanceId: 'calendar', outcome: 'succeeded' },
        { marker: `second-${id}` },
      ),
    ]),
  );
  click('Compare request');
  pick('a');
  fireEvent.click(side('A').querySelector('.phase-select')!);
  fireEvent.click(side('B').querySelectorAll('.phase-select')[1]);
  expect(
    side('A').querySelector('.phase-select')?.getAttribute('aria-pressed'),
  ).toBe('true');
  expect(
    side('B').querySelectorAll('.phase-select')[1].getAttribute('aria-pressed'),
  ).toBe('true');
  expect(
    side('A').querySelector('[aria-label="A event JSON"]')?.textContent,
  ).toContain('b-first');
  expect(
    side('B').querySelector('[aria-label="B event JSON"]')?.textContent,
  ).toContain('a-second');
  click('A event JSON: Raw JSON');
  click('B event JSON: Raw JSON');
  expect(side('A').querySelector<HTMLPreElement>('.json-raw')?.hidden).toBe(
    false,
  );
  expect(side('B').querySelector<HTMLPreElement>('.json-raw')?.hidden).toBe(
    false,
  );
  expect(side('A').querySelector('.json-raw')?.textContent).toContain(
    'first-b',
  );
  expect(side('B').querySelector('.json-raw')?.textContent).toContain(
    'second-a',
  );
  expect(
    shadow.querySelector<HTMLElement>('[aria-label="JSON evidence"]')?.hidden,
  ).toBe(true);
});

test.each([
  'A',
  'B',
] as const)('a redacted phase in %s stays selected until that observation expires', async (selectedSide) => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxRequestEvents: 4,
    maxActivityEvents: 4,
    redact: (value) =>
      value && typeof value === 'object' && 'kind' in value && 'id' in value
        ? { ...value, id: '[REDACTED]' }
        : value,
  });
  const { client } = attach(tools);
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'anchor',
  );
  const emit = (kind: string, marker: number) =>
    client.diagnostics.emitDiagnostic(
      kind,
      { command: 'set_layout', marker },
      undefined,
      'request',
    );
  emit('client.request.started', 0);
  emit('client.command.started', 1);
  emit('client.command.completed', 2);
  const { click, pick, side } = mount(tools);
  if (selectedSide === 'B') pick('anchor');
  click('Compare request');
  if (selectedSide === 'B') pick('request');
  const phase = side(selectedSide).querySelector('.phase-select');
  if (!phase) throw new Error('Missing selected phase');
  fireEvent.click(phase);
  click(`${selectedSide} event JSON: Raw JSON`);
  const raw = () => side(selectedSide).querySelector('.json-raw')?.textContent;
  expect(raw()).toContain('"marker": 0');
  expect(raw()).toContain('[REDACTED]');

  emit('client.command.completed', 3);
  await waitFor(() => expect(raw()).toContain('"marker": 0'));

  emit('client.command.completed', 4);

  await waitFor(() =>
    expect(raw()).toContain('The selected event is no longer retained.'),
  );
  expect(raw()).not.toContain('"marker": 1');
  expect(
    side(selectedSide).querySelectorAll('.phase-select[aria-pressed="true"]')
      .length,
  ).toBe(0);
});

test('a retained comparison phase stays selected after returning to Requests and remounting', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const { client } = attach(tools);
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    { marker: 'selected' },
    undefined,
    'request',
  );
  client.diagnostics.emitDiagnostic(
    'client.command.started',
    { command: 'set_layout', marker: 'latest' },
    undefined,
    'request',
  );
  const panel = mount(tools);
  panel.click('Compare request');
  const phase = panel.side('A').querySelector('.phase-select');
  if (!phase) throw new Error('Missing selected phase');
  fireEvent.click(phase);
  panel.click('Exit comparison');
  panel.click('Raw JSON');
  expect(panel.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"marker": "selected"',
  );
  panel.unmount();

  const remounted = mount(tools);

  expect(remounted.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"marker": "selected"',
  );
});

test('entering comparison preserves the request event shown after visiting Connections', () => {
  const { shadow, click, side } = recording([
    event('connection', undefined, 'client.connection.changed', {
      state: 'connected',
    }),
    event(
      'start',
      'request',
      'client.request.started',
      {},
      { marker: 'selected request' },
    ),
  ]);
  click('Connections');
  fireEvent.click(
    Array.from(shadow.querySelectorAll('.content-pane button')).find((node) =>
      node.textContent?.includes('Engine connection changed'),
    )!,
  );
  click('Requests');
  click('Raw JSON');
  expect(
    shadow.querySelector('[aria-label="JSON evidence"] .json-raw')?.textContent,
  ).toContain('selected request');
  click('Compare request');
  expect(
    side('A').textContent?.includes('Selected phase is no longer retained'),
  ).toBe(false);
  expect(side('A').querySelector('.json-raw')?.textContent).toContain(
    'selected request',
  );
});

test('entering comparison preserves a phase page independently of the selected event', () => {
  const { shadow, click, side } = recording(
    Array.from({ length: 205 }, (_, index) =>
      event(`stage-${index}`, 'request', 'engine.stage.completed', {
        stage: 'plan',
        outcome: 'succeeded',
        durationMs: index,
      }),
    ),
  );
  fireEvent.click(shadow.querySelector('.phase-select')!);
  click('Show more phases');
  expect(shadow.querySelector('.request-phases')?.textContent).toContain(
    'Showing 201–205',
  );
  click('Compare request');
  expect(side('A').querySelector('.request-phases')?.textContent).toContain(
    'Showing 201–205',
  );
});

test.each([
  'bars',
  'timings',
])('comparison reads the latest %s preference even without another render', (control) => {
  const { shadow, click, side } = recording(
    Array.from({ length: 205 }, (_, index) =>
      event(`stage-${index}`, 'request', 'engine.stage.completed', {
        stage: 'plan',
        outcome: 'succeeded',
        durationMs: 1,
      }),
    ),
  );
  if (control === 'bars')
    fireEvent.change(
      shadow.querySelector('.request-phases input[type="checkbox"]')!,
      { target: { checked: false } },
    );
  else click('Show more stage timings');
  click('Compare request');
  if (control === 'bars')
    expect(
      side('A').querySelector<HTMLInputElement>(
        '.request-phases input[type="checkbox"]',
      )?.checked,
    ).toBe(false);
  else
    expect(
      side('A').querySelector(
        '[aria-label="Engine stage timings"] [role="status"]',
      )?.textContent,
    ).toBe('Showing 205 of 205 stage timings');
});

test('comparison preserves the displayed first page when the latest event is selected implicitly', () => {
  const { shadow, click, side } = recording(
    Array.from({ length: 205 }, (_, index) =>
      event(`stage-${index}`, 'request', 'engine.stage.completed', {
        stage: 'plan',
        outcome: 'succeeded',
      }),
    ),
  );
  expect(shadow.querySelector('.request-phases')?.textContent).toContain(
    'Showing 1–200',
  );
  click('Compare request');
  expect(side('A').querySelector('.request-phases')?.textContent).toContain(
    'Showing 1–200',
  );
});

test('comparison ignores another request’s phase page after a pin is released', () => {
  const { shadow, click, pick, side } = recording(
    ['a', 'b'].flatMap((id) =>
      Array.from({ length: 205 }, (_, index) =>
        event(`${id}-${index}`, id, 'engine.stage.completed', {
          stage: 'plan',
          outcome: 'succeeded',
        }),
      ),
    ),
  );
  pick('a');
  click('Show more phases');
  click('Pin request');
  click('Unpin request');
  expect(shadow.querySelector('.request-phases')?.textContent).toContain(
    'Showing 1–200',
  );
  click('Compare request');
  expect(side('A').textContent).toContain('Request b');
  expect(side('A').querySelector('.request-phases')?.textContent).toContain(
    'Showing 1–200',
  );
});

test('presentation controls on A preserve the B JSON cursor', () => {
  const { click, pick, side } = recording(
    ['a', 'b'].flatMap((id) => [
      event(
        `${id}-first`,
        id,
        'client.request.started',
        {},
        { marker: `first-${id}` },
      ),
      event(
        `${id}-second`,
        id,
        'client.response.applied',
        {},
        { marker: `second-${id}` },
      ),
    ]),
  );
  click('Compare request');
  pick('a');
  fireEvent.click(side('B').querySelector('.phase-select')!);
  click('B event JSON: Raw JSON');
  expect(side('B').querySelector('.json-raw')?.textContent).toContain(
    'first-a',
  );
  fireEvent.change(side('A').querySelector('input[type="checkbox"]')!, {
    target: { checked: false },
  });
  expect(side('B').querySelector('.json-raw')?.textContent).toContain(
    'first-a',
  );
});

test('comparison duration controls keep keyboard focus after changing presentation', async () => {
  const { shadow, click, side } = recording([
    event('start', 'request', 'client.request.started'),
  ]);
  click('Compare request');
  const checkbox = side('A').querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  checkbox.focus();
  expect(shadow.activeElement === checkbox).toBe(true);
  fireEvent.change(checkbox, { target: { checked: false } });
  await waitFor(() =>
    expect(
      shadow.activeElement ===
        side('A').querySelector('input[type="checkbox"]'),
    ).toBe(true),
  );
});

test('exiting comparison retains the inspected request’s duration display preference', () => {
  const { shadow, click, side } = recording([
    event('start', 'request', 'client.request.started'),
  ]);
  click('Compare request');
  fireEvent.change(side('A').querySelector('input[type="checkbox"]')!, {
    target: { checked: false },
  });
  click('Exit comparison');
  expect(
    shadow.querySelector<HTMLInputElement>(
      '.request-phases input[type="checkbox"]',
    )?.checked,
  ).toBe(false);
});

test('revealed A stage timings remain available while selecting B evidence', () => {
  const { click, pick, side } = recording(
    ['a', 'b'].flatMap((id) =>
      Array.from({ length: id === 'b' ? 205 : 1 }, (_, index) =>
        event(`${id}-${index}`, id, 'engine.stage.completed', {
          stage: 'plan',
          outcome: 'succeeded',
          durationMs: 1,
        }),
      ),
    ),
  );
  click('Compare request');
  pick('a');
  click('Show more stage timings', side('A'));
  const status = () =>
    side('A').querySelector(
      '[aria-label="Engine stage timings"] [role="status"]',
    )?.textContent;
  expect(status()).toBe('Showing 205 of 205 stage timings');
  fireEvent.click(side('B').querySelector('.phase-select')!);
  expect(status()).toBe('Showing 205 of 205 stage timings');
});

test('an evicted comparison app keeps its label after its lifetime ends', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxSessions: 1,
    maxActivityEvents: 1,
    maxRequestEvents: 2,
  });
  const first = attach(tools);
  first.client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'old',
  );
  const { click, side } = mount(tools);
  click('Compare request');
  const initial = side('A').querySelector('.mono')?.textContent;
  expect(initial).toContain('App instance 1');
  first.detach();
  const second = attach(tools);
  for (let index = 0; index < 3; index++)
    second.client.diagnostics.emitDiagnostic(
      'client.request.started',
      {},
      undefined,
      `new-${index}`,
    );
  expect(side('A').textContent).toContain('no longer retained');
  expect(side('A').querySelector('.mono')?.textContent).toBe(initial);
});

test('a push response has no round-trip measurement instead of an omitted measurement', () => {
  const { shadow, click } = recording([
    event('push', 'push', 'client.response.received', { source: 'push' }),
    event('request', 'request', 'client.request.started'),
  ]);
  click('Compare request');
  fireEvent.click(
    Array.from(shadow.querySelectorAll('.list-pane button')).find((node) =>
      node.textContent?.includes('Push response push'),
    )!,
  );
  const row = Array.from(
    shadow.querySelectorAll('[aria-label="Compared request timings"] tbody tr'),
  ).find(
    (node) => node.querySelector('th')?.textContent === 'Request round-trip',
  )!;
  expect(row.querySelectorAll('td')[1].textContent).toBe(
    'Not applicable (push)',
  );
  expect(row.querySelectorAll('td')[2].textContent).toBe('Not comparable');
});

test('comparison phases label one-sided operations without collapsing repeated Actions', () => {
  const { click, pick, side } = recording(
    ['a', 'b'].flatMap((id) => [
      event(`${id}-start`, id, 'client.request.started'),
      event(`${id}-stage`, id, 'engine.stage.completed', {
        stage: id === 'a' ? 'plan' : 'validate',
        outcome: 'succeeded',
      }),
      ...[0, 1].map((index) =>
        event(`${id}-action-${index}`, id, 'client.action.completed', {
          action: 'open',
          instanceId: id === 'a' ? 'calendar' : 'map',
          toolCallId: 'reused',
          outcome: 'succeeded',
        }),
      ),
      event(`${id}-end`, id, 'client.response.applied'),
    ]),
  );
  click('Compare request');
  pick('a');
  const rows = side('B').querySelectorAll('.phase-table tbody tr');
  expect(rows.length).toBe(5);
  expect(rows[1].textContent).toContain('Unmatched in retained A evidence');
  expect(rows[2].textContent).toContain('Unmatched in retained A evidence');
  expect(rows[3].textContent).toContain('Unmatched in retained A evidence');
  expect(rows[0].textContent).toContain('Correspondence unknown');
});

test.each([
  'client',
  'request',
])('a deleted %s identity leaves counterpart attribution unknown', (missing) => {
  const action = event(
    'unattributed',
    missing === 'request' ? undefined : 'b',
    'client.action.completed',
    {
      clientId: missing === 'client' ? undefined : 'app',
      action: 'open',
      instanceId: 'calendar',
      outcome: 'succeeded',
    },
  );
  const { click, pick, side } = recording([
    event('a-start', 'a', 'client.request.started'),
    event('a-action', 'a', 'client.action.completed', {
      action: 'open',
      instanceId: 'calendar',
      outcome: 'succeeded',
    }),
    event('a-end', 'a', 'client.response.applied'),
    event('b-start', 'b', 'client.request.started'),
    action,
    event('b-end', 'b', 'client.response.applied'),
  ]);
  click('Compare request');
  pick('a');
  expect(
    side('B').querySelectorAll('.phase-table tbody tr')[1].textContent,
  ).toContain('Unknown — incomplete A evidence');
});

test.each([
  ['custom.phase.completed', 'Unknown — incomplete A evidence'],
  ['app.heartbeat', 'Unmatched in retained A evidence'],
])('unattributed %s evidence does not invent custom phase correspondence', (kind, expected) => {
  const { click, pick, side } = recording([
    event('a-start', 'a', 'client.request.started'),
    event('a-custom', 'a', 'custom.phase.completed'),
    event('a-end', 'a', 'client.response.applied'),
    event('b-start', 'b', 'client.request.started'),
    event('unattributed', undefined, kind),
    event('b-end', 'b', 'client.response.applied'),
  ]);
  click('Compare request');
  pick('a');
  const row = Array.from(
    side('B').querySelectorAll('.phase-table tbody tr'),
  ).find((node) =>
    node
      .querySelector('.phase-select')
      ?.textContent?.includes('Custom phase completed'),
  );
  if (!row) throw new Error('Missing custom request phase');
  expect(row.querySelector('.phase-counterpart')?.textContent).toBe(expected);
});

test('both requests expose their recorded arguments together without starting capture', () => {
  const { tools, click, pick, side } = recording(
    ['a', 'b'].map((id) =>
      event(
        id,
        id,
        'client.action.completed',
        { action: 'open', instanceId: 'calendar', outcome: 'succeeded' },
        { arguments: { day: id === 'a' ? 'Monday' : 'Tuesday' } },
      ),
    ),
  );
  click('Compare request');
  pick('a');
  expect(
    side('A').querySelector('[aria-label="A event JSON"]')?.textContent,
  ).toContain('Tuesday');
  expect(
    side('B').querySelector('[aria-label="B event JSON"]')?.textContent,
  ).toContain('Monday');
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('unrelated live activity keeps both content inspectors in the accepted comparison DOM', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const { client } = attach(tools);
  for (const id of ['a', 'b'])
    client.diagnostics.emitDiagnostic(
      'client.request.started',
      {},
      undefined,
      id,
    );
  const { click, pick, side } = mount(tools);
  click('Compare request');
  pick('a');
  const a = side('A').querySelector('[aria-label="A event JSON"]');
  const b = side('B').querySelector('[aria-label="B event JSON"]');
  expect(a?.isConnected).toBe(true);
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'unrelated',
  );
  expect(side('A').querySelector('[aria-label="A event JSON"]') === a).toBe(
    true,
  );
  expect(side('B').querySelector('[aria-label="B event JSON"]') === b).toBe(
    true,
  );
  expect(a?.isConnected && b?.isConnected).toBe(true);
});

test.each([
  'Timings and evidence coverage',
  'Layout changes',
  'Observed issues',
  'Compare observed event counts',
])('the %s disclosure keeps focus when selected-request evidence updates', async (name) => {
  const tools = createDevtools({ initialIsOpen: true });
  const { client } = attach(tools);
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'request',
  );
  client.diagnostics.emitDiagnostic(
    'engine.stage.failed',
    { stage: 'plan', outcome: 'failed' },
    undefined,
    'request',
  );
  const { shadow, click, side } = mount(tools);
  click('Compare request');
  const disclosure = () =>
    Array.from(
      (name === 'Compare observed event counts'
        ? shadow
        : side('A')
      ).querySelectorAll('summary'),
    ).find((node) => node.textContent?.startsWith(name))!;
  disclosure().focus();
  expect(shadow.activeElement === disclosure()).toBe(true);
  client.diagnostics.emitDiagnostic(
    'client.command.completed',
    { command: 'execute_actions' },
    undefined,
    'request',
  );
  await waitFor(() => expect(shadow.activeElement === disclosure()).toBe(true));
});

test('closing comparison clears detached content inspectors before later evidence changes', () => {
  const { tools, click, side } = recording([
    event(
      'action',
      'request',
      'client.action.completed',
      { action: 'open', instanceId: 'calendar' },
      { private: 'private captured value' },
    ),
  ]);
  click('Compare request');
  const content = side('A').querySelector('[aria-label="A event JSON"]')!;
  expect(content.textContent).toContain('private captured value');
  click('Close');
  tools.clear();
  expect(content.textContent).not.toContain('private captured value');
  click('Open Maelstrom Devtools');
  expect(content.isConnected).toBe(false);
});

test('a recording redaction change removes content from both former comparison inspectors', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const { client } = attach(tools);
  tools.startCapture();
  for (const id of ['a', 'b'])
    client.diagnostics.emitDiagnostic(
      'client.request.started',
      {},
      () => ({ private: `secret-${id}` }),
      id,
    );
  tools.stopCapture();
  const { shadow, click, select, pick, side } = mount(tools);
  select('Evidence source', 'recording');
  click('Compare request');
  pick('a');
  const a = side('A').querySelector('[aria-label="A event JSON"]')!;
  const b = side('B').querySelector('[aria-label="B event JSON"]')!;
  expect(a.textContent).toContain('secret-b');
  expect(b.textContent).toContain('secret-a');
  tools.capture.addRedactor((value) =>
    JSON.parse(JSON.stringify(value).replaceAll(/secret-[ab]/g, '[REDACTED]')),
  );
  expect(a.textContent).not.toContain('secret-');
  expect(b.textContent).not.toContain('secret-');
  expect(shadow.textContent).not.toContain('secret-');
  expect(tools.exportCapture()).not.toContain('secret-');
});

test('live comparison explains missing content without evaluating lazy content sources', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const { client } = attach(tools);
  let reads = 0;
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    () => {
      reads++;
      return { private: 'not captured' };
    },
    'request',
  );
  const { click, side } = mount(tools);
  click('Compare request');
  expect(
    side('A').querySelector('[aria-label="A event JSON"]')?.textContent,
  ).toContain('Live event metadata');
  expect(side('A').querySelector('.json-raw')?.textContent).toContain(
    '"requestId": "request"',
  );
  expect(side('A').querySelector('.json-raw')?.textContent).not.toContain(
    'not captured',
  );
  expect(reads).toBe(0);
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('a comparison JSON control keeps focus when request details refresh', async () => {
  const tools = createDevtools({ initialIsOpen: true });
  const { client } = attach(tools);
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'request',
  );
  const { shadow, click, side } = mount(tools);
  click('Compare request');
  const control = Array.from(side('A').querySelectorAll('button')).find(
    (node) => node.getAttribute('aria-label') === 'A event JSON: Raw JSON',
  )!;
  control.focus();
  expect(shadow.activeElement === control).toBe(true);
  client.diagnostics.emitDiagnostic(
    'client.command.completed',
    { command: 'execute_actions' },
    undefined,
    'request',
  );
  await waitFor(() => expect(shadow.activeElement === control).toBe(true));
  expect(control.isConnected).toBe(true);
});

test.each([
  '[REDACTED]',
  undefined,
])('an unreadable event kind %s cannot establish a missing counterpart', (kind) => {
  const { click, pick, side } = recording([
    event('a-start', 'a', 'client.request.started'),
    event('a-action', 'a', 'client.action.completed', {
      action: 'open',
      instanceId: 'calendar',
      outcome: 'succeeded',
    }),
    event('a-end', 'a', 'client.response.applied'),
    event('b-start', 'b', 'client.request.started'),
    {
      ...event('b-hidden', 'b', 'client.action.completed', {
        action: 'open',
        instanceId: 'calendar',
      }),
      kind,
    },
    event('b-end', 'b', 'client.response.applied'),
  ]);
  click('Compare request');
  pick('a');
  expect(
    side('B').querySelectorAll('.phase-table tbody tr')[1].textContent,
  ).toContain('Unknown — incomplete A evidence');
});

test('counterpart uncertainty survives eviction of unattributed live activity', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 1,
    maxRequestEvents: 20,
    redact: (value) => {
      if (
        value &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'client.action.completed' &&
        'requestId' in value &&
        value.requestId === 'b'
      )
        return Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== 'requestId'),
        );
      return value;
    },
  });
  const { client } = attach(tools);
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'a',
  );
  client.diagnostics.emitDiagnostic(
    'client.action.completed',
    { action: 'open', instanceId: 'calendar', outcome: 'succeeded' },
    undefined,
    'a',
  );
  client.diagnostics.emitDiagnostic(
    'client.response.applied',
    {},
    undefined,
    'a',
  );
  client.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'b',
  );
  const { click, pick, side } = mount(tools);
  click('Compare request');
  pick('a');
  const counterpart = () =>
    side('B').querySelectorAll('.phase-table tbody tr')[1].textContent;
  client.diagnostics.emitDiagnostic(
    'client.action.completed',
    { action: 'open', instanceId: 'calendar', outcome: 'succeeded' },
    undefined,
    'b',
  );
  expect(counterpart()).toContain('Unknown — incomplete A evidence');
  client.diagnostics.emitDiagnostic(
    'client.response.applied',
    {},
    undefined,
    'b',
  );
  expect(tools.getSnapshot().droppedRequestEvents).toBe(0);
  expect(tools.getSnapshot().droppedActivityEvents > 0).toBe(true);
  expect(counterpart()).toContain('Unknown — incomplete A evidence');
});
