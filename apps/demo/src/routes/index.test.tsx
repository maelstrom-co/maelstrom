// @vitest-environment happy-dom

import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockConnector } from '../lib/__tests__/mock-connector';

// Same seam as lib/maelstrom.test.tsx — RealtimeSession/OpenAIAdapter/mintToken
// are never real here, this only needs the module graph to evaluate cleanly.
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

vi.mock('../lib/mint-token', () => ({
  mintToken: async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

// createDemoConnector opens a real WebSocketConnector — swapped for the
// shared no-op mock so the route can mount without a live server.
vi.mock('../lib/connector', () => ({
  createDemoConnector: () => createMockConnector(),
}));

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('key drawer gating (hosted, no key)', () => {
  it('does not render the drawer on initial render', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });

  it('opens the drawer once Send is pressed with no key set', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
  });
});
