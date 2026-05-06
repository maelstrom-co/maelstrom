import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMaelstrom } from '@maelstrom-co/react';
import { resetWarnings } from '@maelstrom-co/react/_testing';
import { createMockVoiceConnector } from './__tests__/mock-voice-connector.js';
import { maelstromVoice } from './maelstrom-voice.js';

// Simulate a voice package that loaded but does not expose `VoiceSession`
// (e.g. partially-installed package, transitive resolution to a stub, or a
// custom build that drops the export). The branch in use-voice.ts that
// flips isVoiceSupported to false in this case was previously untested.
mock.module('@maelstrom-co/voice', () => ({
  /* no VoiceSession export */
}));

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

  it('sets isVoiceSupported false and warns when VoiceSession export is absent', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hello' }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.isVoiceSupported).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('did not export VoiceSession'),
    );

    warnSpy.mockRestore();
  });
});
