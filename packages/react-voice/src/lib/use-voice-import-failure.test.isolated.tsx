import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMaelstrom } from '@maelstrom-co/react';
import { resetWarnings } from '@maelstrom-co/react/_testing';
import { createMockVoiceConnector } from './__tests__/mock-voice-connector.js';
import { maelstromVoice } from './maelstrom-voice.js';

// Mock voice to throw (simulates package not installed)
mock.module('@maelstrom-co/voice', () => {
  throw new Error('Cannot find module @maelstrom-co/voice');
});

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('useVoice — import failure', () => {
  beforeEach(() => {
    resetWarnings();
  });

  afterEach(() => {
    cleanup();
  });

  it('sets isVoiceSupported false and warns when voice is not installed', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVoice({ autoAcquireMic: true, greeting: 'hello' }), { wrapper });

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.isVoiceSupported).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('@maelstrom-co/voice is not installed'),
    );

    warnSpy.mockRestore();
  });
});
