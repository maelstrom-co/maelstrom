import type { ConnectorEvent, EngineConnector } from '@maelstrom-co/client';
import { createTestConnector } from '@maelstrom-co/client/_testing';
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
      return {
        type: 'maelstrom_response',
        requestId: message.id,
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      };
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
