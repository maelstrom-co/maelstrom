import { describe, expect, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentInput,
  type ChangeId,
  type MessageId,
} from '@maelstrom-co/protocol';

import type { ConnectorEvent } from '../src/lib/connection-manager/connector.types.js';
import { createMockAgentConnector } from './agent-connector-mock.js';

const placeholder = {
  type: 'placeholder',
  version: AGENT_WIRE_VERSION,
  inputId: 'input-1' as MessageId,
  text: 'working',
} satisfies AgentEvent;

function uiApplied(changeId: string): AgentInput {
  return {
    type: 'ui_applied',
    version: AGENT_WIRE_VERSION,
    changeId: changeId as ChangeId,
    chart: { width: 1, height: 1, instances: [] } as never,
    actionOutcomes: [],
  };
}

describe('createMockAgentConnector', () => {
  test('records every sent input in order', async () => {
    const mock = createMockAgentConnector();
    await mock.connector.sendAgentInput(uiApplied('a'));
    await mock.connector.sendAgentInput(uiApplied('b'));
    expect(mock.inputs.map((input) => input.type)).toEqual([
      'ui_applied',
      'ui_applied',
    ]);
  });

  test('emit reaches handlers until they unsubscribe', () => {
    const mock = createMockAgentConnector();
    const received: AgentEvent[] = [];
    const unsubscribe = mock.connector.onAgentEvent((event) =>
      received.push(event),
    );
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
    await mock.connector.sendAgentInput(uiApplied('old'));
    const pending = mock.nextInput('utterance');
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await mock.connector.sendAgentInput(uiApplied('new'));
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
    await mock.connector.sendAgentInput(utterance);
    expect(await pending).toBe(utterance);
  });
});
