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
