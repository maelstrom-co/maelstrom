import { afterEach, expect, test } from 'bun:test';
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
import {
  createDevtools,
  type Devtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';
import { SessionId } from '@maelstrom-co/protocol';
import { fireEvent, waitFor } from '@testing-library/react';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function attach(tools: Devtools) {
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    subscribe: () => () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
    process: async () => {
      throw new Error('This test only observes diagnostics');
    },
  };
  const client = new Orchestrator(connector, {
    sessionId: SessionId('event-identity'),
    vessels: [],
  });
  cleanups.push(() => client.dispose(), tools.attach(client));
  return (
    kind: string,
    marker: string,
    requestId: string | null = 'request',
    metadata: Record<string, string | number> = {},
  ) =>
    client.diagnostics.emitDiagnostic(
      kind,
      { command: 'set_layout', marker, ...metadata },
      undefined,
      requestId ?? undefined,
    );
}

function copySnapshots(
  tools: Devtools,
  mode: 'structured' | 'JSON' = 'JSON',
): Devtools {
  const copy = (
    snapshot: ReturnType<Devtools['getSnapshot']>,
  ): ReturnType<Devtools['getSnapshot']> =>
    mode === 'structured'
      ? structuredClone(snapshot)
      : JSON.parse(JSON.stringify(snapshot));
  let previous = tools.getSnapshot();
  let copied = copy(previous);
  return new Proxy(tools, {
    get(target, key) {
      if (key === 'getSnapshot')
        return () => {
          const next = target.getSnapshot();
          if (next !== previous) {
            copied = copy(next);
            previous = next;
          }
          return copied;
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function collideIds(markers: readonly string[]) {
  return (value: unknown): unknown => {
    if (
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      'id' in value &&
      'metadata' in value
    ) {
      const metadata = value.metadata;
      if (
        metadata &&
        typeof metadata === 'object' &&
        'marker' in metadata &&
        typeof metadata.marker === 'string' &&
        markers.includes(metadata.marker)
      )
        return { ...value, id: 'shared-id' };
    }
    return value;
  };
}

function mount(tools: Devtools) {
  const unmount = mountDevtools(tools);
  cleanups.push(() => tools.dispose(), unmount);
  const shadow = document.querySelector(
    '[data-maelstrom-devtools]',
  )?.shadowRoot;
  if (!shadow) throw new Error('Missing DevTools panel');
  const click = (name: string) => {
    const target = Array.from(shadow.querySelectorAll('button')).find(
      (node) => (node.getAttribute('aria-label') ?? node.textContent) === name,
    );
    if (!target) throw new Error(`Missing button ${name}`);
    fireEvent.click(target);
  };
  const selectFirst = () => {
    click('Compare request');
    const phase = shadow.querySelector(
      '[aria-label="Comparison A"] .phase-select',
    );
    if (!phase) throw new Error('Missing first phase');
    fireEvent.click(phase);
    click('A event JSON: Raw JSON');
  };
  const raw = () =>
    shadow.querySelector('[aria-label="Comparison A"] .json-raw')?.textContent;
  const selectPhase = (index: number) => {
    const phases = shadow.querySelectorAll(
      '[aria-label="Comparison A"] .phase-select',
    );
    const phase = Array.from(phases).at(index);
    if (!phase) throw new Error('Missing selected phase');
    fireEvent.click(phase);
  };
  return {
    selectFirst,
    selectPhase,
    raw,
    click,
    unmount,
    singleRaw: () => shadow.querySelector('.json-raw')?.textContent,
  };
}

test.each([
  'structured',
  'JSON',
] as const)('a %s snapshot copy preserves its retained selected observation', async (mode) => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  const adapted = copySnapshots(tools, mode);
  emit('client.request.started', 'selected');
  emit('client.command.started', 'later');
  const panel = mount(adapted);
  panel.selectFirst();
  expect(panel.raw()).toContain('"marker": "selected"');
  const before = adapted.getSnapshot();
  expect(adapted.getSnapshot()).toBe(before);

  emit('client.command.completed', 'new');

  expect(adapted.getSnapshot()).not.toBe(before);
  await waitFor(() => expect(panel.raw()).toContain('"marker": "selected"'));
});

test('duplicate IDs cannot select older request evidence through a shorter activity buffer', async () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 1,
    redact: (value) =>
      value && typeof value === 'object' && 'kind' in value && 'id' in value
        ? { ...value, id: 'shared-id' }
        : value,
  });
  const emit = attach(tools);
  emit('client.request.started', 'first');
  emit('client.command.started', 'later');
  const panel = mount(tools);
  panel.selectFirst();

  emit('client.command.completed', 'new');
  panel.selectPhase(-1);

  await waitFor(() => expect(panel.raw()).toContain('"marker": "new"'));
});

test('a retained observation keeps its key when its duplicate ID becomes unique', async () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 1,
    maxRequestEvents: 3,
    redact: collideIds(['first', 'selected']),
  });
  const emit = attach(tools);
  emit('client.request.started', 'first');
  emit('client.command.started', 'selected');
  emit('client.command.completed', 'newer');
  const panel = mount(tools);
  panel.selectFirst();
  panel.selectPhase(1);
  expect(panel.raw()).toContain('"marker": "selected"');

  emit('client.command.completed', 'new');

  await waitFor(() => expect(panel.raw()).toContain('"marker": "selected"'));
});

test('a copied ambiguous ID cannot revive an expired selection', async () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 2,
    maxRequestEvents: 2,
    redact: collideIds(['selected', 'replacement']),
  });
  const emit = attach(tools);
  emit('client.request.started', 'selected');
  const panel = mount(copySnapshots(tools));
  panel.selectFirst();
  expect(panel.raw()).toContain('"marker": "selected"');

  emit('client.command.started', 'replacement');
  await waitFor(() =>
    expect(panel.raw()).toContain('The selected event is no longer retained.'),
  );
  emit('client.command.completed', 'new');

  await waitFor(() =>
    expect(panel.raw()).toContain('The selected event is no longer retained.'),
  );
});

test('an ID returning after retention loss cannot revive an expired selection', async () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 1,
    maxRequestEvents: 1,
    redact: collideIds(['selected', 'replacement']),
  });
  const emit = attach(tools);
  emit('client.request.started', 'selected');
  const panel = mount(copySnapshots(tools));
  panel.selectFirst();

  emit('client.command.started', 'other-id');
  await waitFor(() =>
    expect(panel.raw()).toContain('The selected event is no longer retained.'),
  );
  emit('client.command.completed', 'replacement');

  await waitFor(() =>
    expect(panel.raw()).toContain('The selected event is no longer retained.'),
  );
});

test.each([
  'collector',
  'structured',
  'JSON',
] as const)('transport history cannot revive an expired %s request selection', async (mode) => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 1,
    maxRequestEvents: 1,
    redact: collideIds(['selected', 'transport', 'replacement']),
  });
  const emit = attach(tools);
  emit('client.request.started', 'selected');
  const panel = mount(
    mode === 'collector' ? tools : copySnapshots(tools, mode),
  );
  panel.selectFirst();
  expect(panel.raw()).toContain('"marker": "selected"');

  emit('voice.transport', 'transport', null, {
    state: 'closed',
    providerInstanceId: 'voice',
    providerGeneration: 1,
  });
  emit('client.command.started', 'other-id');
  await waitFor(() =>
    expect(panel.raw()).toContain('The selected event is no longer retained.'),
  );
  emit('client.command.completed', 'replacement');

  await waitFor(() =>
    expect(panel.raw()).toContain('The selected event is no longer retained.'),
  );
});

test.each([
  'Close',
  'Telemetry',
])('an ID expiring while %s is visible cannot replace selected evidence', async (view) => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 1,
    maxRequestEvents: 1,
    redact: collideIds(['selected', 'replacement']),
  });
  const emit = attach(tools);
  emit('client.request.started', 'selected');
  const panel = mount(copySnapshots(tools));
  panel.selectFirst();
  panel.click(view);

  emit('client.command.started', 'other-id');
  emit('client.command.completed', 'replacement');
  panel.click(view === 'Close' ? 'Open Maelstrom Devtools' : 'Requests');

  await waitFor(() =>
    expect(panel.raw()).toContain('The selected event is no longer retained.'),
  );
});

test('remounting a cached copied snapshot preserves selection through subsequent updates', async () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  emit('client.request.started', 'selected');
  emit('client.command.started', 'later');
  const adapted = copySnapshots(tools);
  const first = mount(adapted);
  first.selectFirst();
  first.click('Exit comparison');
  first.click('Raw JSON');
  first.unmount();
  const second = mount(adapted);
  expect(second.singleRaw()).toContain('"marker": "selected"');
  second.selectFirst();

  emit('client.command.completed', 'new');

  await waitFor(() => expect(second.raw()).toContain('"marker": "selected"'));
});

test('remounting after unobserved history loss cannot restore a replacement as the old selection', async () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 2,
    maxRequestEvents: 2,
    redact: collideIds(['selected', 'replacement']),
  });
  const emit = attach(tools);
  emit('client.request.started', 'selected');
  const adapted = copySnapshots(tools);
  const first = mount(adapted);
  first.selectFirst();
  first.click('Exit comparison');
  first.click('Raw JSON');
  first.unmount();

  emit('client.command.started', 'other-id');
  emit('client.command.completed', 'another-id');
  emit('client.command.started', 'replacement');
  emit('client.command.completed', 'latest');
  const second = mount(adapted);

  await waitFor(() =>
    expect(second.singleRaw()).toContain('"marker": "latest"'),
  );
});
