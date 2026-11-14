import type { ConnectorEvent, EngineConnector } from '@maelstrom-co/client';
import { createTestConnector } from '@maelstrom-co/client/_testing';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';

// Mirrors packages/react-realtime/src/lib/__tests__/mock-connector.ts, shared
// here so every apps/demo consumer (voice-component tests, maelstrom.test.tsx,
// etc.) imports the same EngineConnector fake instead of re-implementing it.
export function createMockConnector(): EngineConnector {
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

    async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
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
