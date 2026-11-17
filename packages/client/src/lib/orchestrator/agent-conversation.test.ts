import { describe, expect, it, mock } from 'bun:test';

import {
  ChangeId,
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
});
