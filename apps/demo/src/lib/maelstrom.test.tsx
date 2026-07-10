// @vitest-environment happy-dom

import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
  Unsubscribe,
  VoiceSessionState,
} from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Fakes the module boundary maelstrom.ts wires against — RealtimeSession is
// never real here, so this test observes only that the demo applies the
// maelstromRealtime() extension and mounts a working VoiceOrb; session and
// adapter internals are the package's own tested concern (see
// packages/react-realtime/src/lib/use-voice.test.tsx).
class FakeRealtimeSession {
  state: VoiceSessionState = 'idle';
  constructor(readonly options: unknown) {}
  on(): Unsubscribe {
    return () => {};
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  getAudioStreams() {
    return {};
  }
}

vi.mock('@maelstrom-co/realtime', () => ({
  RealtimeSession: FakeRealtimeSession,
}));

vi.mock('@maelstrom-co/realtime/openai', () => ({
  createOpenAiAdapter: () => ({}),
}));

vi.mock('./mint-token', () => ({
  mintToken: async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

const { m } = await import('./maelstrom');

function createMockConnector(): EngineConnector {
  const subscribers: Array<(event: ConnectorEvent) => void> = [];

  return {
    capabilities: {
      voice: false,
      streaming: false,
      stateful: false,
    } satisfies ConnectorCapabilities,

    async connect() {
      // no-op
    },

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

    subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
      subscribers.push(handler);
      return () => {
        const idx = subscribers.indexOf(handler);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },

    async addAssistantMessage(_message: AssistantMessage): Promise<void> {
      // no-op
    },

    async getHistory() {
      return [];
    },
  };
}

afterEach(cleanup);

describe('maelstrom.ts realtime wiring', () => {
  it('applies the maelstromRealtime() extension', () => {
    expect(typeof m.useVoice).toBe('function');
    expect(typeof m.VoiceOrb).toBe('function');
  });

  it('renders the VoiceOrb within the provider', async () => {
    const connector = createMockConnector();
    const { findByRole } = render(
      <m.Provider connector={connector}>
        <m.VoiceOrb size={56} />
      </m.Provider>,
    );

    const orb = await findByRole('button');
    expect(orb.getAttribute('data-state')).toBe('idle');
  });
});
