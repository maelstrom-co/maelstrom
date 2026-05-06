import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  Unsubscribe,
  VoiceConnector,
} from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
  SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';

export function createMockVoiceConnector(overrides?: {
  process?: (message: ChartRequestMessage) => Promise<MaelstromResponse>;
}): VoiceConnector {
  const subscribers: Array<(event: ConnectorEvent) => void> = [];

  return {
    capabilities: {
      voice: true,
      streaming: true,
      stateful: true,
    } satisfies ConnectorCapabilities,

    async connect(_sessionId: SessionId) {
      // no-op
    },

    async disconnect() {
      for (const handler of [...subscribers]) {
        handler({ type: 'disconnected', clean: true, message: 'test disconnect' });
      }
    },

    async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
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

    subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
      subscribers.push(handler);
      return () => {
        const idx = subscribers.indexOf(handler);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },

    // Voice-specific methods (no-op stubs)
    sendAudioChunk() {
      // no-op
    },
    startListening() {
      // no-op
    },
    stopListening() {
      // no-op
    },
    onVoiceMessage() {
      return () => {};
    },
    onBinaryAudio() {
      return () => {};
    },
    sendVoiceMessage() {
      // no-op
    },
    async addAssistantMessage(_message: AssistantMessage) {
      // no-op
    },
    async getHistory(_sessionId: SessionId): Promise<readonly SessionHistoryEntry[]> {
      return [];
    },
  };
}
