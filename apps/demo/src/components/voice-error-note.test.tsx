// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';

// Keeps RealtimeVoiceError real (VoiceErrorNote's `instanceof` check must
// hold against the actual class) while swapping only RealtimeSession for the
// fake, same split maelstrom.test.tsx and the react-realtime package rely on.
vi.mock('@maelstrom-co/realtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@maelstrom-co/realtime')>();
  return {
    ...actual,
    RealtimeSession: FakeRealtimeSession,
  };
});

vi.mock('@maelstrom-co/realtime-openai', () => ({
  OpenAIAdapter: class {},
}));

vi.mock('../lib/mint-token', () => ({
  mintOpenAIToken: async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

const { m } = await import('../lib/maelstrom');
const { RealtimeVoiceError } = await import('@maelstrom-co/realtime');
const { VoiceErrorNote } = await import('./voice-error-note');

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '0');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
  FakeRealtimeSession.instances = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderNote() {
  const connector = createMockConnector();
  const utils = render(
    <m.Provider connector={connector}>
      <VoiceErrorNote />
    </m.Provider>,
  );
  return { ...utils, session: must(FakeRealtimeSession.instances[0]) };
}

describe('VoiceErrorNote', () => {
  it('renders nothing outside of the error state', () => {
    const { container } = renderNote();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders nothing while connecting or listening', async () => {
    const { container, session } = renderNote();
    await act(async () => {
      session.emitState('listening');
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    [
      'MIC_PERMISSION_DENIED',
      "Microphone access is blocked. Allow the mic in your browser's site settings, then click the orb to retry.",
    ],
    [
      'TOKEN_MINT_FAILED',
      "Voice couldn't start because a session token could not be created. Check the key or server configuration, then retry.",
    ],
    [
      'CONNECTION_FAILED',
      'Voice connection failed. Click the orb to reconnect.',
    ],
    [
      'DATA_CHANNEL_ERROR',
      'The voice channel failed. Click the orb to reconnect.',
    ],
  ] as const)('shows the %s guidance', async (code, expected) => {
    const { container, session } = renderNote();
    session.lastError = new RealtimeVoiceError(code, 'boom');
    await act(async () => {
      session.emitState('error');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      expected,
    );
  });

  it.each([
    [
      403,
      "OpenAI denied Realtime access (HTTP 403). Check the key's project permissions and model access, then retry.",
    ],
    [
      429,
      "OpenAI rate-limited voice setup (HTTP 429). Check the API project's usage limits, then retry.",
    ],
  ] as const)('shows actionable OpenAI setup status %s', async (status, expected) => {
    const { container, session } = renderNote();
    session.lastError = new RealtimeVoiceError(
      'CONNECTION_FAILED',
      `OpenAI realtime call setup failed with status ${status}`,
    );
    await act(async () => {
      session.emitState('error');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      expected,
    );
  });

  it('falls back to a generic message for a non-RealtimeVoiceError', async () => {
    const { container, session } = renderNote();
    session.lastError = new Error('network blew up');
    await act(async () => {
      session.emitState('error');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Voice error. Click the orb to retry.',
    );
  });

  it('falls back to a generic message for an unmapped RealtimeVoiceError code', async () => {
    const { container, session } = renderNote();
    session.lastError = new RealtimeVoiceError('ALREADY_CONNECTED', 'boom');
    await act(async () => {
      session.emitState('error');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Voice error. Click the orb to retry.',
    );
  });

  // A hosted mint failure already reopens the key drawer with the provider's
  // reason. A toast beside it would point the visitor at a drawer that is
  // open in front of them — and must never fall through to the local copy,
  // which blames server env vars a BYOK visitor does not control.
  it('stays silent on a hosted TOKEN_MINT_FAILED, leaving the drawer to explain', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    try {
      const { container, session } = renderNote();
      session.lastError = new RealtimeVoiceError('TOKEN_MINT_FAILED', 'boom');
      await act(async () => {
        session.emitState('error');
      });

      expect(container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('also leaves localhost OpenAI browser-key mint failures to the drawer', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    vi.stubEnv('VITE_VOICE_PROVIDER', 'openai');
    const { container, session } = renderNote();
    session.lastError = new RealtimeVoiceError('TOKEN_MINT_FAILED', 'boom');
    await act(async () => {
      session.emitState('error');
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps server guidance for LiveKit mint failures in browser-key mode', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    vi.stubEnv('VITE_VOICE_PROVIDER', 'livekit');
    const { container, session } = renderNote();
    session.lastError = new RealtimeVoiceError('TOKEN_MINT_FAILED', 'boom');
    await act(async () => {
      session.emitState('error');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /session token could not be created/,
    );
  });

  it('still explains a TOKEN_MINT_FAILED when localhost has a server key', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    const { container, session } = renderNote();
    session.lastError = new RealtimeVoiceError('TOKEN_MINT_FAILED', 'boom');
    await act(async () => {
      session.emitState('error');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /session token could not be created/,
    );
  });

  it('dismisses once state leaves error', async () => {
    const { container, session } = renderNote();
    session.lastError = new RealtimeVoiceError('MIC_PERMISSION_DENIED', 'boom');
    await act(async () => {
      session.emitState('error');
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    await act(async () => {
      session.emitState('connecting');
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
