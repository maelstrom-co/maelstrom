import { describe, expect, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventSchema,
  type AgentInput,
  ChangeId,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';

import type { ConnectorEvent } from '../connection-manager/connector.types.js';
import {
  agentAcceptedEvent,
  agentErrorEvent,
  agentFinishedEvent,
  agentMessageEvent,
  agentPlaceholderEvent,
  agentStartedEvent,
  agentUiChangeEvent,
  createMockAgentConnector,
} from './agent-connector-mock.js';

const placeholder = {
  type: 'placeholder',
  version: AGENT_WIRE_VERSION,
  inputId: 'input-1' as MessageId,
  text: 'working',
} satisfies AgentEvent;

function uiApplied(changeId: string): AgentInput {
  return {
    type: 'ui_applied',
    status: 'applied',
    version: AGENT_WIRE_VERSION,
    changeId: changeId as ChangeId,
    chart: { width: 1, height: 1, instances: [] } as never,
    actionOutcomes: [],
  };
}

describe('createMockAgentConnector', () => {
  test('records every sent input in order', async () => {
    const mock = createMockAgentConnector();
    await mock.connector.sendInput(uiApplied('a'));
    await mock.connector.sendInput(uiApplied('b'));
    expect(mock.inputs.map((input) => input.type)).toEqual([
      'ui_applied',
      'ui_applied',
    ]);
  });

  test('records the input and wakes waiters before delegating to a sendInput override', async () => {
    const failure = new Error('send failed');
    const delegated: AgentInput[] = [];
    const mock = createMockAgentConnector({
      sendInput: (input) => {
        delegated.push(input);
        return Promise.reject(failure);
      },
    });
    const next = mock.nextInput('ui_applied');
    const input = uiApplied('rejected');

    const sent = mock.connector.sendInput(input);

    expect(mock.inputs).toEqual([input]);
    expect(delegated).toEqual([input]);
    expect<AgentInput>(await next).toBe(input);
    await expect(sent).rejects.toBe(failure);
  });

  test('emit reaches handlers until they unsubscribe', () => {
    const mock = createMockAgentConnector();
    const received: AgentEvent[] = [];
    const unsubscribe = mock.connector.onEvent((event) => received.push(event));
    mock.emit(placeholder);
    unsubscribe();
    mock.emit(placeholder);
    expect(received).toEqual([placeholder]);
  });

  test('close fires a disconnected event', () => {
    const mock = createMockAgentConnector();
    const received: ConnectorEvent[] = [];
    mock.connector.subscribe((event) => received.push(event));
    mock.close({ clean: false });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'disconnected', clean: false });
  });

  test('nextInput resolves only on a future input of the matching type', async () => {
    const mock = createMockAgentConnector();
    await mock.connector.sendInput(uiApplied('old'));
    const pending = mock.nextInput('utterance');
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await mock.connector.sendInput(uiApplied('new'));
    await Promise.resolve();
    expect(settled).toBe(false);

    const utterance: AgentInput = {
      type: 'utterance',
      version: AGENT_WIRE_VERSION,
      inputId: 'input-2' as MessageId,
      text: 'hi',
      chart: { width: 1, height: 1, instances: [] } as never,
      source: 'text',
    };
    await mock.connector.sendInput(utterance);
    expect(await pending).toBe(utterance);
  });
});

describe('agent event builders', () => {
  test('build events the agent wire schema accepts', () => {
    const inputId = MessageId('input-1');
    const runId = RunId('run-1');
    const events: AgentEvent[] = [
      agentAcceptedEvent(inputId, runId),
      agentAcceptedEvent(inputId, null),
      agentStartedEvent(runId),
      agentPlaceholderEvent(inputId),
      agentMessageEvent(runId, 'hello'),
      agentFinishedEvent(runId),
      agentFinishedEvent(runId, {
        ok: false,
        reason: 'error',
        error: 'boom',
      }),
      agentErrorEvent({ inputId, error: 'rejected' }),
      agentUiChangeEvent(runId, ChangeId('change-1'), {
        type: 'maelstrom_response',
        requestId: MessageId('response-1'),
        rationale: 'agent change',
        executionPlan: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      }),
    ];

    for (const event of events) {
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    }
    expect(agentAcceptedEvent(inputId, null).disposition).toBe('noise');
  });
});
