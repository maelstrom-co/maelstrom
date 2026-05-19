import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMaelstrom, type MaelstromExtension } from '@maelstrom-co/react';
import { resetWarnings } from '@maelstrom-co/react/_testing';

import { createMockVoiceConnector } from './__tests__/mock-voice-connector.js';
import {
  VOICE_PEER_LOAD_FAILED_MSG,
  VOICE_PEER_NOT_INSTALLED_MSG,
  VoiceDependencyError,
} from './errors.js';
import { createUseVoice } from './use-voice.js';
import { createVoiceOrb } from './voice-orb.js';
import type { VoiceExtension } from './maelstrom-voice.js';
import type { VoiceProbeResult } from './voice-probe.js';

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function customVoice(
  voiceModulePromise: Promise<VoiceProbeResult>,
): MaelstromExtension<VoiceExtension> {
  return (ctx) => {
    const useVoice = createUseVoice(ctx, voiceModulePromise);
    return { useVoice, VoiceOrb: createVoiceOrb(useVoice) };
  };
}

describe('useVoice — dependency error contract', () => {
  beforeEach(() => {
    resetWarnings();
  });

  afterEach(() => {
    cleanup();
  });

  it('failed probe with missing-module error surfaces DEPENDENCY_MISSING', async () => {
    const missing = new Error('Cannot find module @maelstrom-co/voice');
    const probe: Promise<VoiceProbeResult> = Promise.resolve({
      status: 'failed',
      error: missing,
    });

    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(customVoice(probe));
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
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0]?.[0] as unknown;
    expect(err).toBeInstanceOf(VoiceDependencyError);
    const depErr = err as VoiceDependencyError;
    expect(depErr.code).toBe('DEPENDENCY_MISSING');
    expect(depErr.message).toBe(VOICE_PEER_NOT_INSTALLED_MSG);
    expect(depErr.cause).toBe(missing);
  });

  it('failed probe with non-missing error surfaces DEPENDENCY_BROKEN and preserves cause', async () => {
    const broken = new Error('onnxruntime-web failed to initialise');
    const probe: Promise<VoiceProbeResult> = Promise.resolve({
      status: 'failed',
      error: broken,
    });

    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(customVoice(probe));
    const onError = mock((_err: unknown) => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(
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

    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0]?.[0] as unknown;
    expect(err).toBeInstanceOf(VoiceDependencyError);
    const depErr = err as VoiceDependencyError;
    expect(depErr.code).toBe('DEPENDENCY_BROKEN');
    expect(depErr.message).toBe(VOICE_PEER_LOAD_FAILED_MSG);
    expect(depErr.cause).toBe(broken);
  });

  it('onError that throws does not prevent isVoiceSupported flip', async () => {
    const probe: Promise<VoiceProbeResult> = Promise.resolve({
      status: 'failed',
      error: new Error('Cannot find module @maelstrom-co/voice'),
    });

    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(customVoice(probe));

    // Consumer that throws (mimics react-error-boundary's showBoundary).
    const onError = mock((_err: unknown) => {
      throw new Error('boundary re-throw');
    });
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {
      // suppress log noise from the deliberate throw
    });

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
    expect(onError).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('skipped probe is a silent no-op (no onError, no support-flag change)', async () => {
    const probe: Promise<VoiceProbeResult> = Promise.resolve({
      status: 'skipped',
    });

    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(customVoice(probe));
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

    expect(onError).not.toHaveBeenCalled();
    // Connector reports voice: true, so absent any explicit flip the hook
    // falls back to the connector-reported value.
    expect(result.current.isVoiceSupported).toBe(true);
  });
});
