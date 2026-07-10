// @vitest-environment happy-dom

import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockConnector } from './__tests__/mock-connector';

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
  OpenAIAdapter: class {},
}));

vi.mock('./mint-token', () => ({
  mintToken: async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

const { m } = await import('./maelstrom');

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
