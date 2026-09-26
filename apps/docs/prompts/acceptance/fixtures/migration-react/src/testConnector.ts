import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
  Unsubscribe,
} from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
  SessionId,
} from '@maelstrom-co/protocol';

/** Simulated test seam only: this connector never contacts a live Engine. */
export function createSimulatedConnector(): EngineConnector {
  const subscribers: Array<(event: ConnectorEvent) => void> = [];
  return {
    capabilities: {
      voice: false,
      streaming: false,
      stateful: false,
    } satisfies ConnectorCapabilities,
    async connect(_sessionId: SessionId) {},
    async disconnect() {
      for (const handler of subscribers)
        handler({
          type: 'disconnected',
          clean: true,
          message: 'simulated test disconnect',
        });
    },
    async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
      return {
        type: 'maelstrom_response',
        requestId: message.id,
        userMessage: '',
        rationale: 'Simulated test response; not a live Engine result.',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      };
    },
    subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
      subscribers.push(handler);
      return () => {
        const index = subscribers.indexOf(handler);
        if (index >= 0) subscribers.splice(index, 1);
      };
    },
    async addAssistantMessage(_message: AssistantMessage) {},
    async getHistory(_sessionId: SessionId) {
      return [];
    },
  };
}
