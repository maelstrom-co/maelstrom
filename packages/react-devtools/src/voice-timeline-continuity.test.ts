import { expect, test } from 'bun:test';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { fireEvent } from '@testing-library/react';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { attach, event, mount } = createVoicePanelHarness();

test('returning from a related request preserves the Voice filters and selected observation', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('request', 'client.response.applied', {}, 'request'),
          event('selected-call', 'voice.tool.called', { invocationId: 'one' }),
          event(
            'result',
            'voice.tool.result',
            { invocationId: 'one' },
            'request',
          ),
          event('other-generation', 'voice.media', { generation: 2 }),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  const provider = JSON.stringify(['app', 'provider-a']);
  const generation = JSON.stringify(['session', 1]);
  select('Voice provider lifetime', provider);
  select('Voice generation', generation);
  click('Inspect observation 1: Tool called');
  click('Raw JSON');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'selected-call',
  );

  click('Open request request');
  expect(shadow.querySelector('.request-outcome')?.textContent).toContain(
    'request',
  );
  click('Voice');

  expect(
    shadow.querySelector<HTMLSelectElement>(
      '[aria-label="Voice provider lifetime"]',
    )?.value,
  ).toBe(provider);
  expect(
    shadow.querySelector<HTMLSelectElement>('[aria-label="Voice generation"]')
      ?.value,
  ).toBe(generation);
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'selected-call',
  );
  expect(
    shadow
      .querySelector('[aria-label="Inspect observation 1: Tool called"]')
      ?.getAttribute('aria-pressed'),
  ).toBe('true');
});

test('Voice follows the most recently active lane until the user selects a lane', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  emit('voice.media', { generation: 1, marker: 'a-first' });
  emit('voice.media', { generation: 2, marker: 'b-first' });
  emit('voice.media', { generation: 1, marker: 'a-latest' });
  const { shadow, click } = mount(tools);
  click('Voice');
  click('Raw JSON');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain('a-latest');
  expect(shadow.querySelector('.row-button')?.textContent).toContain(
    'Session generation 1',
  );

  emit('voice.media', { generation: 2, marker: 'b-latest' });
  expect(shadow.querySelector('.json-raw')?.textContent).toContain('b-latest');
  expect(shadow.querySelector('.row-button')?.textContent).toContain(
    'Session generation 2',
  );

  const first = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>('.row-button'),
  ).find((node) => node.textContent?.includes('Session generation 1'));
  if (!first) throw new Error('Missing generation one');
  fireEvent.click(first);
  emit('voice.media', { generation: 2, marker: 'new-unselected-evidence' });
  expect(shadow.querySelector('.json-raw')?.textContent).toContain('a-latest');
  expect(
    shadow.querySelector('.row-button[aria-pressed="true"]')?.textContent,
  ).toContain('Session generation 1');
});

test.each([
  'invocation',
  'response',
] as const)('a new %s cannot inherit completed evidence across partial live eviction', (type) => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 2 });
  const emit = attach(tools);
  const startKind =
    type === 'invocation' ? 'voice.tool.called' : 'voice.provider.wire';
  const endKind =
    type === 'invocation' ? 'voice.tool.result' : 'voice.provider.wire';
  const start: Record<string, string | number | boolean> =
    type === 'invocation'
      ? { invocationId: 'collapsed' }
      : {
          providerGeneration: 1,
          responseId: 'collapsed',
          responsePhase: 'started',
        };
  const end: Record<string, string | number | boolean> =
    type === 'invocation'
      ? { invocationId: 'collapsed' }
      : {
          providerGeneration: 1,
          responseId: 'collapsed',
          responsePhase: 'finished',
        };
  emit('client.request.started', {}, 'old-request');
  emit(startKind, start);
  emit(endKind, end, 'old-request');
  const { shadow, click } = mount(tools);
  click('Voice');

  emit(startKind, start);
  click(
    type === 'invocation'
      ? 'Inspect observation 2: Tool called'
      : 'Inspect observation 2: Provider observation',
  );

  expect(shadow.querySelector('.voice-events')?.textContent).not.toContain(
    type === 'invocation' ? 'Tool invocation' : 'Provider response',
  );
  expect(
    Array.from(shadow.querySelectorAll('button')).some(
      (node) => node.textContent === 'Open request old-request',
    ),
  ).toBe(false);
});

test.each([
  ['invocation', 'Voice'],
  ['response', 'Voice'],
  ['invocation', 'Close'],
  ['response', 'Close'],
  ['invocation', 'unmounted'],
  ['response', 'unmounted'],
] as const)('completed %s ownership cannot recover after a full gap while %s', (type, mode) => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 2 });
  const emit = attach(tools);
  const kind =
    type === 'invocation' ? 'voice.tool.called' : 'voice.provider.wire';
  const start: Record<string, string | number | boolean> =
    type === 'invocation'
      ? { invocationId: 'reused' }
      : {
          providerGeneration: 1,
          responseId: 'reused',
          responsePhase: 'started',
        };
  const end: Record<string, string | number | boolean> =
    type === 'invocation'
      ? { invocationId: 'reused' }
      : {
          providerGeneration: 1,
          responseId: 'reused',
          responsePhase: 'finished',
        };
  emit(kind, start);
  emit(type === 'invocation' ? 'voice.tool.result' : kind, end);
  let view = mount(tools);
  view.click('Voice');
  if (mode === 'Close') view.click('Close');
  if (mode === 'unmounted') view.unmount();
  emit('client.connection.changed', { status: 'connected' });
  emit('client.connection.changed', { status: 'connected' });
  emit(kind, start);
  if (mode === 'unmounted') view = mount(tools);
  if (mode === 'Close') view.click('Open Maelstrom Devtools');
  expect(view.shadow.querySelector('.voice-events')?.textContent).not.toContain(
    type === 'invocation' ? 'Tool invocation' : 'Provider response',
  );
});

test('overlapping live snapshots and remounts do not manufacture lifecycle collisions', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 4 });
  const emit = attach(tools);
  let view = mount(tools);
  emit('voice.tool.called', { invocationId: 'one' });
  emit('voice.media');
  emit('voice.tool.result', { invocationId: 'one' });
  view.click('Voice');
  expect(view.shadow.querySelector('.voice-events')?.textContent).toContain(
    'Tool invocation 1',
  );
  view.unmount();
  view = mount(tools);
  emit('voice.media');
  expect(view.shadow.querySelector('.voice-events')?.textContent).toContain(
    'Tool invocation 1',
  );
  expect(
    view.shadow.querySelector('.voice-timeline')?.textContent,
  ).not.toContain('Grouping is unavailable');
});

test.each([
  'invocation',
  'response',
] as const)('copied live snapshots do not manufacture a second %s lifecycle', (type) => {
  const tools = createDevtools({ initialIsOpen: true });
  const emit = attach(tools);
  const copied = new Proxy(tools, {
    get(target, property) {
      if (property === 'getSnapshot')
        return () => {
          const snapshot = tools.getSnapshot();
          return { ...snapshot, activity: structuredClone(snapshot.activity) };
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const { shadow, click } = mount(copied);
  if (type === 'invocation') {
    emit('voice.tool.called', { invocationId: 'one' });
    emit('voice.tool.result', { invocationId: 'one' });
  } else {
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'one',
      responsePhase: 'started',
    });
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'one',
      responsePhase: 'finished',
    });
  }
  if (type === 'invocation') emit('voice.media');
  else emit('voice.provider.wire', { providerGeneration: 1 });
  click('Voice');
  expect(shadow.querySelector('.voice-events')?.textContent).toContain(
    type === 'invocation' ? 'Tool invocation 1' : 'Provider response 1',
  );
  expect(shadow.querySelector('.voice-timeline')?.textContent).not.toContain(
    'Grouping is unavailable',
  );
});

test('exhausting bounded lifecycle history cannot silently restore grouping', () => {
  const tools = createDevtools({ maxActivityEvents: 2 });
  const emit = attach(tools);
  const { shadow, click } = mount(tools);
  for (let index = 0; index < 4096; index++) {
    emit('voice.tool.called', { invocationId: `observed-${index}` });
  }
  emit('voice.tool.called', { invocationId: 'new' });
  emit('voice.tool.result', { invocationId: 'new' });
  click('Open Maelstrom Devtools');
  click('Voice');
  expect(shadow.querySelector('.voice-events')?.textContent).not.toContain(
    'Tool invocation',
  );
  expect(shadow.querySelector('.voice-timeline')?.textContent).toContain(
    'Grouping is unavailable',
  );
});

test('Voice shows a disabled ownership link for colliding request lifecycles', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('request-a', 'client.request.started', {}, 'request'),
          event('applied-a', 'client.response.applied', {}, 'request'),
          event('request-b', 'client.request.started', {}, 'request'),
          event('applied-b', 'client.response.applied', {}, 'request'),
          event(
            'result',
            'voice.tool.result',
            { invocationId: 'one' },
            'request',
          ),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  const link = Array.from(shadow.querySelectorAll('button')).find(
    (node) => node.textContent === 'Open request request',
  );
  expect(link?.disabled).toBe(true);
  expect(shadow.querySelector('.voice-requests')?.textContent).toContain(
    'Related request ownership is ambiguous.',
  );
});
