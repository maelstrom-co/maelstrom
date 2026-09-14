// @vitest-environment happy-dom

import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_VOICE_OBSERVATIONS } from './__tests__/fake-realtime-session';
import { createMockConnector } from './__tests__/mock-connector';
import { selectVoiceProvider } from './voice-provider';

// Fakes the module boundary maelstrom.ts wires against — RealtimeSession is
// never real here, so this test observes only that the demo applies the
// maelstromRealtime() extension and mounts a working VoiceOrb; session and
// adapter internals are the package's own tested concern (see
// packages/react-realtime/src/lib/use-voice.test.tsx).
class FakeRealtimeSession {
  static instances: FakeRealtimeSession[] = [];
  state: VoiceSessionState = 'idle';
  observations = {
    getSnapshot: () => EMPTY_VOICE_OBSERVATIONS,
    subscribe: () => () => {},
  };
  constructor(readonly options: unknown) {
    FakeRealtimeSession.instances.push(this);
  }
  on(): Unsubscribe {
    return () => {};
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  getAudioStreams() {
    return {};
  }
}

vi.mock('@maelstrom-co/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime')>()),
  RealtimeSession: FakeRealtimeSession,
}));

vi.mock('@maelstrom-co/realtime-openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime-openai')>()),
  OpenAIAdapter: class {},
}));

vi.mock('./mint-token', () => ({
  mintOpenAIToken: async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
}));

const { m, DEMO_GREETING } = await import('./maelstrom');

beforeEach(() => {
  FakeRealtimeSession.instances = [];
});

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

  it.each([
    'live',
    'realtime',
  ] as const)('configures the %s opening without mixing generated and fixed greetings', (provider) => {
    selectVoiceProvider(provider);
    const connector = createMockConnector();
    render(
      <m.Provider connector={connector}>
        <m.VoiceOrb size={56} />
      </m.Provider>,
    );

    const session = FakeRealtimeSession.instances[0];
    expect(session).toBeDefined();
    if (provider === 'live') {
      expect(session?.options).toMatchObject({
        generatedOpening: {
          instructions: expect.stringContaining('Maelstrom'),
        },
      });
      expect(session?.options).not.toHaveProperty('greeting');
    } else {
      expect(session?.options).toMatchObject({
        greeting: { text: DEMO_GREETING },
      });
      expect(session?.options).not.toHaveProperty('generatedOpening');
    }
  });
});
