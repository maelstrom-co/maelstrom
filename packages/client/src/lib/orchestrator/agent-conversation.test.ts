import { describe, expect, it, mock } from 'bun:test';

import {
  ActionName,
  ChangeId,
  type ChartRequest,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';

import {
  agentUiChangeEvent,
  createMockAgentConnector,
} from '../__test-helpers__/agent-connector-mock.js';
import type { Logger } from '../utils/logger.js';
import { AgentConversation } from './agent-conversation.js';
import type { AgentConversationEvents } from './conversation-event.types.js';

const emptyResponse: MaelstromResponse = {
  type: 'maelstrom_response',
  requestId: MessageId('response-1'),
  rationale: 'agent change',
  executionPlan: [],
  layout: { type: 'tiling', tree: [], instances: [] },
};

describe('AgentConversation', () => {
  it('keeps missing Action evidence off the wire while notifying positional subscribers', async () => {
    const agent = createMockAgentConnector();
    const conversation = new AgentConversation({
      currentConnector: () => agent.connector,
      buildChart: () => ({}) as ChartRequest,
      dispatchChange: () => Promise.reject(new Error('queue unavailable')),
      captureFence: () => () => null,
      logger: { warn: () => {} } as unknown as Logger,
      agentRunStaleTimeoutMs: Number.POSITIVE_INFINITY,
      diagnostics: { emit: () => {} },
      now: () => 0,
    });
    try {
      conversation.attach();
      const changes: AgentConversationEvents['ui_change'][] = [];
      conversation.events.on('ui_change', (event) => changes.push(event));
      const applied = agent.nextInput('ui_applied');
      agent.emit(
        agentUiChangeEvent(RunId('run-1'), ChangeId('change-1'), {
          ...emptyResponse,
          executionPlan: [
            { instanceId: InstanceId('board'), action: ActionName('record') },
          ],
        }),
      );
      expect(await applied).toMatchObject({
        status: 'unknown',
        actionOutcomes: [],
      });
      expect(changes).toMatchObject([
        {
          status: 'unknown',
          actionOutcomes: [{ ok: false, error: 'no result recorded' }],
        },
      ]);
    } finally {
      conversation.dispose();
    }
  });

  it('emits ui_change and warns without an unhandled rejection when building the acknowledgement Chart throws', async () => {
    const agent = createMockAgentConnector();
    const warn = mock((..._args: unknown[]) => {});
    const conversation = new AgentConversation({
      currentConnector: () => agent.connector,
      buildChart: () => {
        throw new Error('chart unavailable');
      },
      dispatchChange: () => Promise.reject(new Error('queue gone')),
      captureFence: () => () => null,
      logger: { warn } as unknown as Logger,
      agentRunStaleTimeoutMs: Number.POSITIVE_INFINITY,
      diagnostics: { emit: () => {} },
      now: () => 0,
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      conversation.attach();
      const changes: AgentConversationEvents['ui_change'][] = [];
      conversation.events.on('ui_change', (event) => changes.push(event));

      agent.emit(
        agentUiChangeEvent(RunId('run-1'), ChangeId('change-1'), emptyResponse),
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(changes.map((change) => change.changeId)).toEqual([
        ChangeId('change-1'),
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        'ui_applied for change-1 was not sent',
      );
      expect(agent.inputs).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      conversation.dispose();
    }
  });

  it('answers not_sent without sending, stops the stale watch and keeps no conversation when onSending throws', async () => {
    const agent = createMockAgentConnector();
    const conversation = new AgentConversation({
      currentConnector: () => agent.connector,
      buildChart: () => ({}) as ChartRequest,
      dispatchChange: () => Promise.reject(new Error('unused')),
      captureFence: () => () => null,
      logger: { warn: () => {} } as unknown as Logger,
      agentRunStaleTimeoutMs: 5,
      diagnostics: { emit: () => {} },
      now: () => 0,
    });
    conversation.attach();
    const losses: AgentConversationEvents['conversation_lost'][] = [];
    conversation.events.on('conversation_lost', (event) => losses.push(event));
    try {
      const outcome = await conversation.sendMessage(
        MessageId('input-1'),
        'hello',
        undefined,
        () => {
          throw new Error('observer failed');
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      conversation.reportDisconnected();

      expect(outcome).toMatchObject({
        status: 'not_sent',
        error: { message: 'observer failed' },
      });
      expect(agent.inputs).toEqual([]);
      expect(losses).toEqual([]);
    } finally {
      conversation.dispose();
    }
  });
});
