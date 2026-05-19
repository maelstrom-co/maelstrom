import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMaelstrom } from '@maelstrom-co/react';
import { resetWarnings } from '@maelstrom-co/react/_testing';

import { createMockVoiceConnector } from './__tests__/mock-voice-connector.js';
import {
  VOICE_SESSION_EXPORT_MISSING_MSG,
  VoiceDependencyError,
} from './errors.js';
import { maelstromVoice } from './maelstrom-voice.js';

// Module resolves successfully but omits `VoiceSession`, exercising the
// `DEPENDENCY_BROKEN` branch that fires when the peer is present but the
// expected export is missing.
mock.module('@maelstrom-co/voice', () => ({}));

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('useVoice — voice module missing VoiceSession export', () => {
  beforeEach(() => {
    resetWarnings();
  });

  afterEach(() => {
    cleanup();
  });

  it('invokes onError with VoiceDependencyError(DEPENDENCY_BROKEN) and sets isVoiceSupported false', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());
    const onError = mock((_err: unknown) => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(
      () =>
        m.useVoice({
          autoAcquireMic: true,
          greeting: 'hello',
          onError,
        }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.isVoiceSupported).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0]?.[0] as unknown;
    expect(err).toBeInstanceOf(VoiceDependencyError);
    const depErr = err as VoiceDependencyError;
    expect(depErr.code).toBe('DEPENDENCY_BROKEN');
    expect(depErr.message).toBe(VOICE_SESSION_EXPORT_MISSING_MSG);
  });
});
