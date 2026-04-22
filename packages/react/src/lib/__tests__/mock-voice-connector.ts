import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  Unsubscribe,
  VoiceConnector,
} from '@maelstrom-co/client';
import type { ChartRequest, MaelstromResponse, SessionId } from '@maelstrom-co/protocol';

export function createMockVoiceConnector(overrides?: {
  process?: (request: ChartRequest) => Promise<MaelstromResponse>;
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
  };
}
