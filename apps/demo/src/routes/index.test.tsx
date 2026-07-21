// @vitest-environment happy-dom

import { WireEngineError } from '@maelstrom-co/client';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
  STORAGE_KEY,
} from '../lib/playground-key-store';

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

// Lets individual tests swap in a connector whose process() rejects (e.g.
// simulating a text-path 401), without each test needing its own vi.mock
// factory. vi.hoisted so the ref exists before the vi.mock factory below runs.
const connectorOverride = vi.hoisted(() => ({
  process: null as null | ((message: unknown) => Promise<unknown>),
}));

// createDemoConnector opens a real WebSocketConnector — swapped for the
// shared no-op mock so the route can mount without a live server.
vi.mock('../lib/connector', () => ({
  createDemoConnector: () => {
    const base = createMockConnector();
    return connectorOverride.process
      ? { ...base, process: connectorOverride.process }
      : base;
  },
}));

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '1');
  FakeRealtimeSession.instances = [];
  localStorage.clear();
  clearPlaygroundKey();
  connectorOverride.process = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
  clearPlaygroundKey();
  connectorOverride.process = null;
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

describe('text-path key failures (hosted)', () => {
  it('reopens the drawer with an actionable message on a chart_request 401', async () => {
    setPlaygroundKey('sk-rejected', true);
    connectorOverride.process = async () => {
      throw new WireEngineError(
        '401 Incorrect API key provided: [redacted]',
        'ProviderError',
      );
    };

    const { HomePage } = await import('./index');
    render(<HomePage />);

    // A stored key means no drawer up front — the failure must be what
    // reopens it, not the keyless-gating path already covered above.
    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
    expect(screen.getByText('Invalid API key.')).toBeTruthy();
  });

  it('preserves the submitted draft instead of clearing it when the key that submitted it is rejected', async () => {
    // Regression: processIntent() never rejects (failures surface via
    // lastError), so an unconditional clear after the await wipes the draft
    // even though the request failed — the visitor's typed intent is lost
    // right when the drawer reopens to ask for a corrected key.
    setPlaygroundKey('sk-rejected', true);
    connectorOverride.process = async () => {
      throw new WireEngineError(
        '401 Incorrect API key provided: [redacted]',
        'ProviderError',
      );
    };

    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
    expect(
      (screen.getByPlaceholderText(/tell maelstrom/i) as HTMLInputElement)
        .value,
    ).toBe('plan my day');
  });

  it('does not reopen the drawer for a non-key provider failure', async () => {
    setPlaygroundKey('sk-fine', true);
    connectorOverride.process = async () => {
      throw new WireEngineError('rate limit exceeded', 'ProviderError');
    };

    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/rate limit exceeded/i)).toBeTruthy();
    });
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });
});

describe('mic-path key gating (hosted, no key)', () => {
  it('opens the drawer instead of starting a voice session when the orb is clicked with no key set', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /voice/i }));

    expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    const session = must(FakeRealtimeSession.instances[0]);
    expect(session.connectCalls).toBe(0);
  });
});

describe('header "API key" affordance', () => {
  it('is hidden when not hosted', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(
      screen.queryByRole('button', { name: /api key/i }),
    ).toBeNull();
  });

  it('is visible when hosted', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(
      screen.getByRole('button', { name: /api key/i }),
    ).toBeTruthy();
  });

  it('opens the drawer when clicked, with no key set', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /api key/i }));

    expect(screen.getByLabelText(/api key/i)).toBeTruthy();
  });

  it('does not auto-submit typed text when the drawer is opened via the header button', async () => {
    // Regression: onSave used to unconditionally arm resumeIntent off
    // whatever text happened to be in the box, so opening the drawer from
    // the header (not a blocked Send) still auto-submitted it on save.
    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: /api key/i }));
    expect(screen.getByLabelText(/api key/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-new-key' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/api key/i)).toBeNull();
    });
    // No auto-submit fired, so the typed text is untouched.
    expect(
      (screen.getByPlaceholderText(/tell maelstrom/i) as HTMLInputElement)
        .value,
    ).toBe('plan my day');
  });
});

describe('resumeIntent auto-submit', () => {
  it('sends the intent typed before the drawer interrupted, once the post-save reconnect lands', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-new-key' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    // The drawer closes and the reconnect (fresh keyEpoch) auto-submits the
    // intent that was typed before it was interrupted — the input clears
    // once that submit resolves, without the visitor having to press Send
    // again.
    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText(/tell maelstrom/i) as HTMLInputElement)
          .value,
      ).toBe('');
    });
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });
});

describe('removing a stored key', () => {
  it('clears localStorage and the store, closes the drawer, and re-prompts on the next Send', async () => {
    setPlaygroundKey('sk-stored', true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sk-stored');

    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.click(screen.getByRole('button', { name: /api key/i }));
    expect(screen.getByLabelText(/api key/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /remove key/i }));

    // Drawer closes.
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    // Custody state is fully cleared.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // The app is back in the keyless state — the next Send re-prompts.
    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
  });
});
