import type { ConnectorEvent, EngineConnector } from '@maelstrom-co/client';
import {
  createMockAgentConnector,
  createTestConnector,
  type MockAgentConnector,
} from '@maelstrom-co/client/_testing';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';

export function createMockConnector(overrides?: {
  process?: (message: ChartRequestMessage) => Promise<MaelstromResponse>;
}): EngineConnector {
  const subscribers: Array<(event: ConnectorEvent) => void> = [];

  return createTestConnector({
    async disconnect() {
      for (const handler of subscribers) {
        handler({
          type: 'disconnected',
          clean: true,
          message: 'test disconnect',
        });
      }
    },

    async process(message) {
      if (overrides?.process) {
        return overrides.process(message);
      }
      return emptyResponse(message);
    },

    subscribe(handler) {
      subscribers.push(handler);
      return () => {
        const idx = subscribers.indexOf(handler);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
  });
}

/**
 * A scriptable agent connector whose engine requests answer with an empty
 * response. `overrides` replaces any connector method, including `process`.
 */
export function createMockAgentEngineConnector(
  overrides: Partial<EngineConnector> = {},
): MockAgentConnector {
  return createMockAgentConnector({
    process: async (message) => emptyResponse(message),
    ...overrides,
  });
}

function emptyResponse(message: ChartRequestMessage): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: message.id,
    userMessage: '',
    rationale: '',
    executionPlan: [],
    layout: { type: 'grid', positions: [] },
  };
}
