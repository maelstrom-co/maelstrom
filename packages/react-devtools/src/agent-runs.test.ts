import { expect, test } from 'bun:test';

import { Orchestrator } from '@maelstrom-co/client';
import { createTestConnector } from '@maelstrom-co/client/_testing';
import { createDevtools } from '@maelstrom-co/devtools/production';
import type { DiagnosticEvent } from '@maelstrom-co/protocol';

import { createVoicePanelHarness } from '../test-utils/voice.js';

const { mount, cleanups } = createVoicePanelHarness();

test('the Agent tab renders live run groups and the session timeline after recent activity evicts them', () => {
  const tools = createDevtools({ initialIsOpen: true, maxActivityEvents: 2 });
  const client = new Orchestrator(
    createTestConnector({
      process: async () => {
        throw new Error('No application work is expected');
      },
    }),
  );
  const observers: Parameters<typeof client.diagnostics.subscribe>[0][] = [];
  const subscribe = client.diagnostics.subscribe.bind(client.diagnostics);
  client.diagnostics.subscribe = (listener) => {
    observers.push(listener);
    return subscribe(listener);
  };
  cleanups.push(() => {
    void client.dispose();
  }, tools.attach(client));
  const deliver = (event: DiagnosticEvent) => {
    for (const observer of observers) observer({ event });
  };
  deliver(runEvent('engine.agent.input.accepted', { disposition: 'agent' }));
  deliver(runEvent('engine.agent.run.started', { disposition: 'agent' }));
  deliver(runEvent('engine.agent.turn.started', turn));
  deliver(
    runEvent('engine.agent.tool.started', {
      ...turn,
      callId: 'call-1',
      toolName: 'lookup_orders',
    }),
  );
  deliver(
    runEvent('engine.agent.tool.completed', {
      ...turn,
      callId: 'call-1',
      toolName: 'lookup_orders',
      outcome: 'succeeded',
      durationMs: 40,
    }),
  );
  deliver(
    runEvent('engine.agent.turn.finished', {
      ...turn,
      toolCalls: 1,
      inputTokens: 120,
      outputTokens: 30,
    }),
  );
  deliver(
    runEvent('engine.agent.run.finished', {
      reason: 'completed',
      outcome: 'succeeded',
      turns: 1,
      toolCalls: 1,
      elapsedMs: 850,
      durationMs: 850,
      inputTokens: 120,
      outputTokens: 30,
    }),
  );
  deliver({
    id: 'rejected',
    kind: 'engine.agent.input.rejected',
    at: 20,
    sessionId: 'session',
    metadata: { code: 'queue_full', inputId: 'input-2' },
  });
  for (let index = 0; index < 4; index++)
    client.diagnostics.emit('voice.session');
  expect(tools.getSnapshot().activity).toHaveLength(2);

  const { shadow, click } = mount(tools);
  click('Agent');

  const row = shadow.querySelector('[data-agent-run]');
  expect(row?.textContent).toContain('Completed');
  expect(row?.textContent).toContain('850 ms');
  expect(row?.textContent).toContain('1 turn');
  expect(row?.textContent).toContain('1 tool call');
  const session = shadow.querySelector('[aria-label="Agent session timeline"]');
  expect(session?.textContent).toContain('Input rejected');
  expect(session?.textContent).toContain('Queue full');
});

test('the Agent tab renders a recorded run group with its turn timeline, linked client events and recorded content', () => {
  const tools = createDevtools({ initialIsOpen: true });
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: {
        schemaVersion: 1,
        events: [
          captured('sent', 'client.agent.input.sent', {
            inputId: 'input-1',
          }),
          captured(
            'accepted',
            'engine.agent.input.accepted',
            { inputId: 'input-1', disposition: 'agent', source: 'text' },
            'run-1',
          ),
          captured(
            'turn-started',
            'engine.agent.turn.started',
            { inputId: 'input-1', ...turn },
            'run-1',
          ),
          captured(
            'turn-finished',
            'engine.agent.turn.finished',
            { inputId: 'input-1', ...turn, toolCalls: 0 },
            'run-1',
            { text: 'Recorded turn reply' },
          ),
          captured(
            'finished',
            'engine.agent.run.finished',
            {
              inputId: 'input-1',
              reason: 'budget',
              outcome: 'failed',
              limit: 'turns',
              turns: 1,
              toolCalls: 0,
              elapsedMs: 2400,
              durationMs: 2400,
              inputTokens: 5,
              outputTokens: 7,
            },
            'run-1',
          ),
        ],
      },
    }),
  );
  const { shadow, click, select } = mount(tools);
  select('Evidence source', 'imported');
  click('Agent');

  const row = shadow.querySelector('[data-agent-run]');
  expect(row?.textContent).toContain('Budget');
  expect(row?.textContent).toContain('2.4 s');
  expect(row?.textContent).toContain('Limit turns');
  const detail = shadow.querySelector('.agent-run-detail');
  expect(detail?.textContent).toContain('Client sent input');
  expect(detail?.textContent).toContain('Turn 1');
  click('Inspect Turn finished');
  click('Raw JSON');
  expect(shadow.querySelector('.json-raw')?.textContent).toContain(
    'Recorded turn reply',
  );
});

test('the Agent tab shows only the runs and session timeline of the selected app instance', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const deliverToA = attachWithDelivery(tools);
  const deliverToB = attachWithDelivery(tools);
  const [a, b] = tools.getSnapshot().sessions;
  deliverToA(agentEvent('run-a', 'engine.agent.input.accepted'));
  deliverToA(agentEvent('run-a', 'engine.agent.run.finished', completed));
  deliverToA(
    sessionEvent('engine.agent.input.rejected', { code: 'queue_full' }),
  );
  deliverToB(agentEvent('run-b', 'engine.agent.input.accepted'));
  deliverToB(agentEvent('run-b', 'engine.agent.run.finished', completed));
  deliverToB(
    sessionEvent('engine.agent.input.ignored', { reason: 'duplicate_input' }),
  );
  const { shadow, click, select } = mount(tools);
  click('Agent');
  const rows = () =>
    Array.from(shadow.querySelectorAll('[data-agent-run]')).map(
      (row) => row.querySelector('.row-title')?.textContent,
    );
  const session = () =>
    shadow.querySelector('[aria-label="Agent session timeline"]')
      ?.textContent ?? '';
  expect(rows()).toEqual(['Run run-b', 'Run run-a']);

  select('App instance', a.id);
  expect(rows()).toEqual(['Run run-a']);
  expect(session()).toContain('Input rejected');
  expect(session()).not.toContain('Input ignored');

  select('App instance', b.id);
  expect(rows()).toEqual(['Run run-b']);
  expect(session()).toContain('Input ignored');
  expect(session()).not.toContain('Input rejected');
});

test('the Agent tab reports a selected run and event evicted by run retention and the dropped run events', () => {
  const tools = createDevtools({ initialIsOpen: true, maxRunEvents: 2 });
  const deliver = attachWithDelivery(tools);
  const { shadow, click } = mount(tools);
  click('Agent');
  expect(shadow.querySelector('.agent-runs')?.textContent).toContain(
    'No agent runs match this selection.',
  );
  deliver(agentEvent('run-1', 'engine.agent.input.accepted'));
  deliver(agentEvent('run-1', 'engine.agent.run.finished', completed));
  click('Inspect Input accepted');
  expect(shadow.querySelector('.agent-run-detail h3')?.textContent).toBe(
    'Run run-1',
  );

  deliver(agentEvent('run-2', 'engine.agent.input.accepted'));
  deliver(agentEvent('run-2', 'engine.agent.run.finished', completed));
  const dropped = tools.getSnapshot().droppedRunEvents;
  expect(dropped).toBe(2);
  const content = shadow.querySelector('.agent-runs')?.textContent;
  expect(content).toContain('The selected agent run is no longer retained.');
  expect(content).toContain('The selected agent event is no longer retained.');
  expect(shadow.querySelector('.agent-run-detail')).toBeNull();
  const text = visibleText(shadow);
  expect(text).toContain('agent run metadata events');
  expect(text).toContain(`${dropped} dropped or evicted`);
  expect(text).toContain(
    `${dropped} older agent events were dropped or evicted.`,
  );
});

test('the Agent tab pages runs and session events and keeps a selected run visible past the page', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const deliver = attachWithDelivery(tools);
  for (let index = 1; index <= 51; index++)
    deliver(agentEvent(`run-${index}`, 'engine.agent.input.accepted'));
  for (let index = 1; index <= 51; index++)
    deliver(
      sessionEvent('engine.agent.input.rejected', { code: 'queue_full' }),
    );
  const { shadow, click } = mount(tools);
  click('Agent');
  const rows = () => shadow.querySelectorAll('[data-agent-run]');
  const sessionRows = () =>
    shadow.querySelectorAll('[aria-label="Agent session timeline"] tbody tr');
  const moreButtons = () =>
    Array.from(shadow.querySelectorAll('button'))
      .map((node) => node.textContent ?? '')
      .filter((label) => label.startsWith('Show more'));
  expect(rows()).toHaveLength(50);
  expect(sessionRows()).toHaveLength(50);
  expect(moreButtons()).toEqual([
    'Show more agent runs (50 of 51)',
    'Show more session events (50 of 51)',
  ]);
  click('Show more agent runs (50 of 51)');
  expect(rows()).toHaveLength(51);
  expect(sessionRows()).toHaveLength(51);
  expect(moreButtons()).toEqual([]);

  selectRun(shadow, 'run-1');
  deliver(agentEvent('run-52', 'engine.agent.input.accepted'));
  deliver(agentEvent('run-53', 'engine.agent.input.accepted'));
  click('Requests');
  click('Agent');
  const titles = Array.from(rows()).map(
    (row) => row.querySelector('.row-title')?.textContent,
  );
  expect(titles).toHaveLength(51);
  expect(titles.at(-1)).toBe('Run run-1');
  expect(
    shadow.querySelector('[data-agent-run][aria-pressed="true"]')?.textContent,
  ).toContain('Run run-1');
  click('Show more agent runs (51 of 53)');
  expect(rows()).toHaveLength(53);
});

test('changing the evidence source resets the selected agent run', () => {
  const tools = createDevtools({ initialIsOpen: true });
  const deliver = attachWithDelivery(tools);
  deliver(agentEvent('run-1', 'engine.agent.input.accepted'));
  deliver(agentEvent('run-2', 'engine.agent.input.accepted'));
  tools.importCapture(
    JSON.stringify({
      schemaVersion: 2,
      capture: { schemaVersion: 1, events: [] },
    }),
  );
  const { shadow, click, select } = mount(tools);
  click('Agent');
  const detail = () =>
    shadow.querySelector('.agent-run-detail h3')?.textContent;
  expect(detail()).toBe('Run run-2');
  selectRun(shadow, 'run-1');
  expect(detail()).toBe('Run run-1');

  select('Evidence source', 'imported');
  expect(detail()).toBeUndefined();
  select('Evidence source', 'live');
  expect(detail()).toBe('Run run-2');
});

const turn = { turnId: 'run-1:t1', turnIndex: 1 };
let sequence = 0;

function runEvent(
  kind: string,
  metadata: Record<string, string | number | boolean>,
): DiagnosticEvent {
  sequence++;
  return {
    id: `run-event-${sequence}`,
    kind,
    at: sequence,
    sessionId: 'session',
    runId: 'run-1',
    metadata: { inputId: 'input-1', ...metadata },
  };
}

function captured(
  id: string,
  kind: string,
  metadata: Record<string, unknown>,
  runId?: string,
  content?: unknown,
) {
  return {
    id,
    kind,
    at: 100,
    sessionId: 'session',
    runId,
    metadata: { clientId: 'app', ...metadata },
    content,
  };
}

const completed = { reason: 'completed', outcome: 'succeeded' };

function attachWithDelivery(tools: ReturnType<typeof createDevtools>) {
  const client = new Orchestrator(
    createTestConnector({
      process: async () => {
        throw new Error('No application work is expected');
      },
    }),
  );
  const observers: Parameters<typeof client.diagnostics.subscribe>[0][] = [];
  const subscribe = client.diagnostics.subscribe.bind(client.diagnostics);
  client.diagnostics.subscribe = (listener) => {
    observers.push(listener);
    return subscribe(listener);
  };
  cleanups.push(() => {
    void client.dispose();
  }, tools.attach(client));
  return (event: DiagnosticEvent) => {
    for (const observer of observers) observer({ event });
  };
}

function agentEvent(
  runId: string,
  kind: string,
  metadata: Record<string, string | number | boolean> = {},
): DiagnosticEvent {
  sequence++;
  return {
    id: `agent-event-${sequence}`,
    kind,
    at: sequence,
    sessionId: 'session',
    runId,
    metadata: { inputId: `${runId}-input`, ...metadata },
  };
}

function sessionEvent(
  kind: string,
  metadata: Record<string, string | number | boolean>,
): DiagnosticEvent {
  sequence++;
  return {
    id: `session-event-${sequence}`,
    kind,
    at: sequence,
    sessionId: 'session',
    metadata,
  };
}

function selectRun(shadow: ShadowRoot, runId: string): void {
  const row = Array.from(
    shadow.querySelectorAll<HTMLElement>('[data-agent-run]'),
  ).find(
    (node) => node.querySelector('.row-title')?.textContent === `Run ${runId}`,
  );
  if (!row) throw new Error(`Missing agent run row ${runId}`);
  row.click();
}

function visibleText(shadow: ShadowRoot): string {
  return Array.from(shadow.children)
    .filter((node) => node.tagName !== 'STYLE')
    .map((node) => node.textContent ?? '')
    .join(' ');
}
