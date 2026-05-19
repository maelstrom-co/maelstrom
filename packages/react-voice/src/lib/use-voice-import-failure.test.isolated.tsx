import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMaelstrom } from '@maelstrom-co/react';
import { resetWarnings } from '@maelstrom-co/react/_testing';

import { createMockVoiceConnector } from './__tests__/mock-voice-connector.js';
import {
  VOICE_PEER_NOT_INSTALLED_MSG,
  VoiceDependencyError,
} from './errors.js';
import { maelstromVoice } from './maelstrom-voice.js';

// Error message shape must match `isMissingModuleError` so the probe
// surfaces `DEPENDENCY_MISSING` rather than `DEPENDENCY_BROKEN`. Mock at
// module scope so it is installed before the dynamic import inside
// `maelstromVoice()` resolves.
mock.module('@maelstrom-co/voice', () => {
  throw new Error('Cannot find module @maelstrom-co/voice');
});

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('useVoice — import failure (peer not installed)', () => {
  beforeEach(() => {
    resetWarnings();
  });

  afterEach(() => {
    cleanup();
  });

  it('invokes onError with VoiceDependencyError(DEPENDENCY_MISSING) and sets isVoiceSupported false', async () => {
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
    expect(depErr.code).toBe('DEPENDENCY_MISSING');
    expect(depErr.message).toBe(VOICE_PEER_NOT_INSTALLED_MSG);
    expect(depErr.cause).toBeInstanceOf(Error);
  });
});
