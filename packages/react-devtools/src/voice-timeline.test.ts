import { expect, test } from 'bun:test';
import { Orchestrator } from '@maelstrom-co/client';
import { createDevtools } from '@maelstrom-co/devtools/production';
import { fireEvent } from '@testing-library/react';
import { createVoicePanelHarness } from '../test-utils/voice.js';

const { attach, event, mount, cleanups } = createVoicePanelHarness();

test('custom recorded media fields stay inspectable when they are not scalar activity facts', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.capture.start('fixture');
  tools.capture.record('voice.media', {
    metadata: {
      clientId: 'app',
      provider: 'live',
      providerInstanceId: 'provider',
      generation: 1,
      generationScope: 'session',
      userSpeech: { toString: null, valueOf: null },
      incomingAudio: { toString: null, valueOf: null },
    },
  });
  tools.capture.stop();
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'recording');
  click('Voice');
  click('Raw JSON');
  expect(shadow.querySelector('.voice-events')?.textContent).toContain(
    'Media changed',
  );
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'userSpeech',
  );
});

test('a redacted tool result cannot open a request which contradicts its retained source lane', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('source', 'voice.media'),
          {
            ...event(
              'result',
              'voice.tool.result',
              { invocationId: 'one' },
              'request',
            ),
            sessionId: '[REDACTED]',
          },
          {
            ...event('destination', 'client.response.applied', {}, 'request'),
            sessionId: 'other-session',
          },
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
  expect(link).toBeDefined();
  expect(link?.disabled).toBe(true);
  expect(shadow.querySelector('.voice-requests')?.textContent).toContain(
    'Related request ownership is ambiguous.',
  );
});

test.each([
  ['explicit unknown', { outcome: 'unknown', ok: false }, 'Unknown'],
  ['legacy unknown', { ok: false }, 'Unknown'],
  ['succeeded', { ok: true }, 'Succeeded'],
  ['reported failure', { outcome: 'failed', ok: false }, 'Failed'],
] as const)('voice results preserve the %s outcome in table and diagram', (_name, metadata, outcome) => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [event('result', 'voice.tool.result', metadata)],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  expect(shadow.querySelector('.voice-events')?.textContent).toContain(outcome);
  expect(
    shadow.querySelector<HTMLButtonElement>('.voice-point')?.title,
  ).toContain(outcome);
  if (outcome === 'Unknown') {
    expect(shadow.querySelector('.voice-events')?.textContent).not.toContain(
      'Failed',
    );
    expect(
      shadow.querySelector<HTMLButtonElement>('.voice-point')?.title,
    ).not.toContain('Failed');
  }
});

test('voice evidence opens the selected observation and its proven request without starting capture', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('request', 'client.request.started', {}, 'engine-rq'),
          event('called', 'voice.tool.called', {
            invocationId: 'invocation',
            callId: 'call',
            tool: 'update_ui',
          }),
          event('applied', 'client.response.applied', {}, 'engine-rq'),
          event(
            'result',
            'voice.tool.result',
            { invocationId: 'invocation', callId: 'call', ok: true },
            'engine-rq',
          ),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  expect(shadow.textContent).toContain('Session generation 1');
  click('Inspect observation 2: Tool result');
  click('Raw JSON');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    '"id": "result"',
  );
  expect(
    shadow
      .querySelector('[aria-label="Inspect observation 2: Tool result"]')
      ?.getAttribute('aria-pressed'),
  ).toBe('true');
  click('Open request engine-rq');
  expect(shadow.querySelector('.request-outcome')?.textContent).toContain(
    'engine-rq',
  );
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('opening Voice after inspecting a connection selects voice evidence rather than an unrelated expired cursor', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('voice-evidence', 'voice.session.connected'),
          event('connection-evidence', 'client.connection.changed', {
            status: 'connected',
          }),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Connections');
  const connection = Array.from(
    shadow.querySelectorAll('.content-pane button'),
  ).find((node) => node.textContent?.startsWith('Engine connection changed'));
  if (!connection) throw new Error('Missing connection observation');
  fireEvent.click(connection);
  click('Raw JSON');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'connection-evidence',
  );

  click('Voice');

  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'voice-evidence',
  );
});

test('voice filters separate provider lifetimes and independent generation scopes in an imported recording', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('session-one', 'voice.tool.called', { invocationId: 'one' }),
          event('provider-one', 'voice.provider.wire', {
            providerGeneration: 1,
            responseId: 'one',
            responsePhase: 'observed',
          }),
          event('session-two', 'voice.tool.called', {
            generation: 2,
            invocationId: 'two',
          }),
          event('other-provider', 'voice.session.connected', {
            providerInstanceId: 'provider-b',
            provider: 'livekit',
          }),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  expect(shadow.querySelectorAll('.list-pane button')).toHaveLength(4);
  const provider = shadow.querySelector<HTMLSelectElement>(
    'select[aria-label="Voice provider lifetime"]',
  )!;
  const first = Array.from(provider.options).find((option) =>
    option.textContent?.includes('live · provider'),
  )!;
  select('Voice provider lifetime', first.value);
  expect(shadow.querySelectorAll('.list-pane button')).toHaveLength(3);
  const generations = shadow.querySelector<HTMLSelectElement>(
    'select[aria-label="Voice generation"]',
  )!;
  const native = Array.from(generations.options).find(
    (option) => option.textContent === 'Provider generation 1',
  )!;
  select('Voice generation', native.value);
  expect(shadow.querySelectorAll('.list-pane button')).toHaveLength(1);
  expect(shadow.querySelector('.voice-events')?.textContent).toContain(
    'Provider response 1',
  );
  click('Raw JSON');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'provider-one',
  );
  click('Reset voice filters');
  expect(shadow.querySelectorAll('.list-pane button')).toHaveLength(4);
});

test('recorded transcript text renders as text while missing request evidence stays unavailable', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event(
            'transcript',
            'voice.transcript.fragment',
            { role: 'user', fragmentId: 'fragment' },
            undefined,
            { text: '<img src=x onerror=alert(1)>' },
          ),
          event(
            'result',
            'voice.tool.result',
            { invocationId: 'one', ok: true },
            'missing',
          ),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  const missing = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>('button'),
  ).find((node) => node.textContent === 'Open request missing');
  expect(missing?.disabled).toBe(true);
  click('Inspect observation 1: Transcript fragment');
  expect(shadow.querySelector('.voice-timeline pre')?.textContent).toBe(
    '<img src=x onerror=alert(1)>',
  );
  expect(shadow.querySelector('.voice-timeline img')).toBeNull();
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('live voice updates preserve selected JSON until that observation is evicted', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 2 });
  const client = new Orchestrator({
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    subscribe: () => () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
    process: async () => {
      throw new Error('No application work is expected');
    },
  });
  cleanups.push(() => {
    void client.dispose();
  }, tools.attach(client));
  const emit = (marker: string) =>
    client.diagnostics.emitDiagnostic('voice.media', {
      provider: 'live',
      providerInstanceId: 'provider',
      generation: 1,
      generationScope: 'session',
      marker,
    });
  emit('selected');
  const { shadow, click } = mount(tools);
  click('Voice');
  click('Inspect observation 1: Media changed');
  click('Raw JSON');
  const raw = () => shadow.querySelector('.json-raw')?.textContent;
  expect(raw()).toContain('"marker": "selected"');

  emit('later');
  expect(raw()).toContain('"marker": "selected"');
  emit('replacement');

  expect(raw()).toContain('The selected event is no longer retained.');
  expect(shadow.querySelector('.voice-point[aria-pressed="true"]')).toBeNull();
  expect(shadow.querySelector('.voice-event[aria-pressed="true"]')).toBeNull();
  expect(tools.capture.getSnapshot().active).toBe(false);
});

test('activity cannot enable a related request which has expired from request history', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    maxActivityEvents: 10,
    maxRequestEvents: 1,
  });
  const emit = attach(tools);
  emit('client.request.started', {}, 'old');
  emit('voice.tool.result', { invocationId: 'one' }, 'old');
  emit('client.request.started', {}, 'new');
  const { shadow, click } = mount(tools);
  click('Voice');
  const link = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>('button'),
  ).find((node) => node.textContent === 'Open request old');
  expect(link?.disabled).toBe(true);
});

test.each([
  ['invocation', 'Voice'],
  ['response', 'Voice'],
  ['invocation', 'Telemetry'],
  ['response', 'Telemetry'],
  ['invocation', 'Close'],
  ['response', 'Close'],
] as const)('a known %s collision stays unlinked while %s is visible during eviction', (type, view) => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 3 });
  const emit = attach(tools);
  if (type === 'invocation') {
    emit('client.request.started', {}, 'request-a');
    emit('voice.tool.called', {
      invocationId: 'collapsed',
      callId: 'reused',
      marker: 'first',
    });
    emit('voice.tool.called', {
      invocationId: 'collapsed',
      callId: 'reused',
      marker: 'second',
    });
    emit(
      'voice.tool.result',
      { invocationId: 'collapsed', callId: 'reused' },
      'request-a',
    );
  } else {
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'collapsed',
      responsePhase: 'started',
      eventType: 'response.created',
      marker: 'first',
    });
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'collapsed',
      responsePhase: 'started',
      eventType: 'response.created',
      marker: 'second',
    });
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'collapsed',
      responsePhase: 'finished',
      eventType: 'response.done',
      status: 'completed',
    });
  }
  const { shadow, click } = mount(tools);
  click('Voice');
  click(
    type === 'invocation'
      ? 'Inspect observation 2: Tool called'
      : 'Inspect observation 2: Provider observation',
  );
  expect(shadow.querySelector('.voice-events')?.textContent).not.toContain(
    type === 'invocation' ? 'Tool invocation' : 'Provider response',
  );
  if (view !== 'Voice') click(view);

  emit(
    type === 'invocation' ? 'voice.media' : 'voice.provider.wire',
    type === 'invocation' ? {} : { providerGeneration: 1 },
  );
  if (view !== 'Voice')
    click(view === 'Close' ? 'Open Maelstrom Devtools' : 'Voice');

  expect(shadow.querySelector('.voice-events')?.textContent).not.toContain(
    type === 'invocation' ? 'Tool invocation' : 'Provider response',
  );
  expect(
    Array.from(shadow.querySelectorAll('button')).some(
      (node) => node.textContent === 'Open request request-a',
    ),
  ).toBe(false);
});

test('replacing an import while unmounted cannot restore its old Voice selection into reused IDs', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const recording = (first: string, last: string) =>
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          event('same-first', 'voice.media', { marker: first }),
          event('same-last', 'voice.media', { marker: last }),
        ],
      },
    });
  tools.importCapture(recording('selected', 'later'));
  const first = mount(tools);
  first.select('Evidence source', 'imported');
  first.click('Voice');
  first.click('Inspect observation 1: Media changed');
  first.click('Raw JSON');
  expect(first.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"marker": "selected"',
  );
  first.unmount();

  tools.importCapture(recording('replacement', 'newest'));
  const second = mount(tools);

  expect(second.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"marker": "newest"',
  );
});

test('replacing a recording while unmounted clears its positional Voice cursor', () => {
  const tools = createDevtools({
    initialIsOpen: true,
    redact: (value) =>
      value && typeof value === 'object' && 'entryId' in value
        ? { ...value, entryId: 'collapsed' }
        : value,
  });
  const record = (first: string, last: string) => {
    tools.capture.start('fixture');
    for (const marker of [first, last])
      tools.capture.record('voice.media', {
        metadata: {
          clientId: 'app',
          provider: 'live',
          providerInstanceId: 'provider',
          generation: 1,
          generationScope: 'session',
          marker,
        },
      });
    tools.capture.stop();
  };
  record('selected', 'later');
  const first = mount(tools);
  first.select('Evidence source', 'recording');
  first.click('Voice');
  first.click('Inspect observation 1: Media changed');
  first.click('Raw JSON');
  expect(first.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"marker": "selected"',
  );
  first.unmount();
  record('replacement', 'newest');

  const second = mount(tools);

  expect(second.shadow.querySelector('.json-raw')?.textContent).toContain(
    '"marker": "newest"',
  );
});

test.each([
  'invocation',
  'response',
] as const)('a poisoned %s lane cannot recover false ownership after an empty buffer and remount', (type) => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 3 });
  const emit = attach(tools);
  emit('client.request.started', {}, 'old-request');
  if (type === 'invocation') {
    emit('voice.tool.called', { invocationId: 'collapsed', callId: 'reused' });
    emit('voice.tool.called', { invocationId: 'collapsed', callId: 'reused' });
  } else {
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'collapsed',
      responsePhase: 'started',
      eventType: 'response.created',
    });
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'collapsed',
      responsePhase: 'started',
      eventType: 'response.created',
    });
  }
  const first = mount(tools);
  first.click('Voice');
  for (let index = 0; index < 3; index++)
    emit(
      type === 'invocation' ? 'voice.media' : 'voice.provider.wire',
      type === 'invocation' ? {} : { providerGeneration: 1 },
    );
  first.unmount();
  if (type === 'invocation') {
    emit(
      'voice.tool.result',
      { invocationId: 'collapsed', callId: 'reused' },
      'old-request',
    );
    emit('voice.tool.called', { invocationId: 'collapsed', callId: 'reused' });
  } else {
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'collapsed',
      responsePhase: 'finished',
      eventType: 'response.done',
      status: 'completed',
    });
    emit('voice.provider.wire', {
      providerGeneration: 1,
      responseId: 'collapsed',
      responsePhase: 'started',
      eventType: 'response.created',
    });
  }
  const second = mount(tools);

  expect(
    second.shadow.querySelector('.voice-events')?.textContent,
  ).not.toContain(
    type === 'invocation' ? 'Tool invocation' : 'Provider response',
  );
});

test('a full collision history keeps live grouping unavailable instead of forgetting unsafe lanes', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 3 });
  const emit = attach(tools);
  const { shadow, click } = mount(tools);
  click('Voice');
  for (let index = 0; index < 65; index++) {
    const metadata = {
      providerInstanceId: `provider-${index}`,
      invocationId: 'collapsed',
    };
    emit('voice.tool.called', metadata);
    emit('voice.tool.called', metadata);
  }
  emit('voice.tool.called', {
    providerInstanceId: 'new-provider',
    invocationId: 'unique',
  });
  emit('voice.tool.result', {
    providerInstanceId: 'new-provider',
    invocationId: 'unique',
  });

  expect(shadow.querySelector('.voice-events')?.textContent).not.toContain(
    'Tool invocation',
  );
  expect(shadow.querySelector('.voice-timeline')?.textContent).toContain(
    'Grouping is unavailable',
  );
});

test('a response with many related requests renders links in bounded batches', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const events = Array.from({ length: 60 }, (_, index) => [
    event(`request-${index}`, 'client.request.started', {}, `request-${index}`),
    event(
      `voice-${index}`,
      'voice.provider.wire',
      {
        providerGeneration: 1,
        responseId: 'response-many',
        responsePhase: 'observed',
        eventType: 'response.output_item.added',
      },
      `request-${index}`,
    ),
  ]).flat();
  tools.importCapture(
    JSON.stringify({ schemaVersion: 2, capture: { schemaVersion: 1, events } }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Voice');
  expect(shadow.querySelectorAll('.voice-requests button')).toHaveLength(51);
  click('Show more request links (50 of 60)');
  expect(shadow.querySelectorAll('.voice-requests button')).toHaveLength(60);
});
