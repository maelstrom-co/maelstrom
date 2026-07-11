// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';

// Keeps RealtimeVoiceError real (the drawer-reopen effect's `instanceof`
// check must hold against the actual class) while swapping only
// RealtimeSession for the fake — same split voice-error-note.test.tsx uses.
vi.mock('@maelstrom-co/realtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@maelstrom-co/realtime')>();
  return {
    ...actual,
    RealtimeSession: FakeRealtimeSession,
  };
});

vi.mock('@maelstrom-co/realtime/openai', () => ({
  OpenAIAdapter: class {},
}));

vi.mock('../lib/mint-token', () => ({
  mintToken: async () => {
    throw new Error('mintToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

// createDemoConnector opens a real WebSocketConnector — swapped for the
// shared no-op mock so the route can mount without a live server.
vi.mock('../lib/connector', () => ({
  createDemoConnector: () => createMockConnector(),
}));

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '1');
  FakeRealtimeSession.instances = [];
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

describe('voice mint failures (hosted)', () => {
  it('reopens the drawer with an actionable message on a token-mint failure', async () => {
    const { HomePage } = await import('./index');
    const { RealtimeVoiceError } = await import('@maelstrom-co/realtime');
    render(<HomePage />);

    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    const session = must(FakeRealtimeSession.instances[0]);
    session.lastError = new RealtimeVoiceError(
      'TOKEN_MINT_FAILED',
      'Failed to mint an ephemeral realtime token',
      new Error('Invalid API key.'),
    );
    await act(async () => {
      session.emitState('error');
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
    expect(screen.getByText('Invalid API key.')).toBeTruthy();
  });

  it('does not reopen the drawer for a non-mint voice error', async () => {
    const { HomePage } = await import('./index');
    const { RealtimeVoiceError } = await import('@maelstrom-co/realtime');
    render(<HomePage />);

    const session = must(FakeRealtimeSession.instances[0]);
    session.lastError = new RealtimeVoiceError(
      'MIC_PERMISSION_DENIED',
      'boom',
    );
    await act(async () => {
      session.emitState('error');
    });

    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });
});
