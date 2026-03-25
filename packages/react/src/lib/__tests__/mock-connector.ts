import type { EngineConnector, ConnectorCapabilities, ConnectorEvent, Unsubscribe } from '@maelstrom-co/client';
import type { ChartRequest, MaelstromResponse } from '@maelstrom-co/protocol-old';

export function createMockConnector(overrides?: {
  process?: (request: ChartRequest) => Promise<MaelstromResponse>;
}): EngineConnector {
  const subscribers: Array<(event: ConnectorEvent) => void> = [];

  return {
    capabilities: { voice: false, streaming: false, stateful: false } satisfies ConnectorCapabilities,

    async connect() {
      // no-op
    },

    async disconnect() {
      for (const handler of subscribers) {
        handler({ type: 'disconnected', clean: true, message: 'test disconnect' });
      }
    },

    async process(request: ChartRequest): Promise<MaelstromResponse> {
      if (overrides?.process) {
        return overrides.process(request);
      }
      return {
        type: 'maelstrom_response',
        requestId: request.id,
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      };
    },

    subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
      subscribers.push(handler);
      return () => {
        const idx = subscribers.indexOf(handler);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
  };
}
