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

vi.mock('@maelstrom-co/realtime/openai', () => ({
  OpenAIAdapter: class {},
}));

vi.mock('../lib/mint-token', () => ({
  mintOpenAIToken: async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
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
  FakeRealtimeSession.instances = [];
});

afterEach(cleanup);

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
      "Voice couldn't start — the server couldn't mint a session token. Check the server logs or configuration, then try again.",
    ],
    [
      'CONNECTION_FAILED',
      'Voice connection dropped. Click the orb to reconnect.',
    ],
    [
      'DATA_CHANNEL_ERROR',
      'Voice connection dropped. Click the orb to reconnect.',
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
