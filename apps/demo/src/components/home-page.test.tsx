// @vitest-environment happy-dom

import type { EngineConnector } from '@maelstrom-co/client';
import { createMaelstrom } from '@maelstrom-co/react';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { LiveTransportError } from '@maelstrom-co/realtime-protocol/openai-live';
import { act, cleanup, render } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';

interface VoiceResultStub {
  state: string;
  error: unknown;
  connect: () => Promise<void>;
}

let voiceResult: VoiceResultStub;
const m = createMaelstrom({ vessels: [] });
type ProviderProps = ComponentProps<typeof m.Provider>;

vi.doMock('../lib/maelstrom', () => ({
  m: {
    ...m,
    // The home Vessels are not registered here, so the seeded first screen
    // stays out of the real Provider.
    Provider: ({
      initialLayout: _initialLayout,
      ...props
    }: ProviderProps & { initialLayout?: unknown }) => (
      <m.Provider {...(props as ProviderProps)} />
    ),
    useVoice: () => voiceResult,
    useTouchedInstances: () => new Set<string>(),
    Chart: () => null,
    Devtools: () => null,
  },
  prepareBrowserOpenAIVoice: () => false,
}));
vi.doMock('../lib/connector', () => ({
  createDemoConnector: () => idleConnector(),
}));
vi.doMock('../lib/hosted-mode', () => ({
  isHosted: () => false,
  usesBrowserKey: () => true,
  usesBrowserOpenAIVoice: () => true,
}));
vi.doMock('../lib/hosted-vad', () => ({
  preloadHostedVadAssets: async () => {},
}));
vi.doMock('../lib/diagnostic-capture', () => ({
  diagnosticCapture: { stop: () => {} },
}));
vi.doMock('../lib/use-touched-instances', () => ({
  useFlashInstances: () => {},
}));
vi.doMock('./demo-header', () => ({
  DemoHeader: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
}));
vi.doMock('./first-run-hint', () => ({ FirstRunHint: () => null }));
vi.doMock('./intent-input', () => ({ IntentInput: () => null }));
vi.doMock('./keyless-demo', () => ({ KeylessDemo: () => null }));
vi.doMock('./vessel-option-sync', () => ({ VesselOptionSync: () => null }));
vi.doMock('./voice-provider-select', () => ({
  VoiceProviderSelect: () => null,
}));
vi.doMock('./key-drawer', () => ({
  KeyDrawer: ({
    isOpen,
    errorMessage,
  }: {
    isOpen: boolean;
    errorMessage?: string | null;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="API key">
        {errorMessage}
      </div>
    ) : null,
}));
const { HomePage } = await import('./home-page');

class MeasuredResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1024 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  setPlaygroundKey('test-only-not-a-provider-key');
  voiceResult = { state: 'idle', error: undefined, connect: async () => {} };
});

afterEach(() => {
  cleanup();
  clearPlaygroundKey();
  vi.unstubAllGlobals();
});

describe('HomePage voice key errors', () => {
  it.each([
    [
      'an HTTP 401 exchange',
      new LiveTransportError('exchange_rejected', { status: 401 }),
    ],
    ['a missing key', new LiveTransportError('missing_key')],
  ])('reopens the key drawer with the Live key message for %s', async (_case, cause) => {
    voiceResult = {
      ...voiceResult,
      state: 'error',
      error: new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Live connection failed',
        cause,
      ),
    };

    const view = await renderHome();

    expect(view.getByRole('dialog', { name: 'API key' }).textContent).toBe(
      'Live could not use this API key. Update the key, then reconnect.',
    );
  });

  it('leaves the key drawer closed when Live fails for a reason other than the key', async () => {
    voiceResult = {
      ...voiceResult,
      state: 'error',
      error: new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Live connection failed',
        new LiveTransportError('exchange_rejected', { status: 429 }),
      ),
    };

    const view = await renderHome();

    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('keeps reopening the key drawer with the mint message when a token mint fails', async () => {
    voiceResult = {
      ...voiceResult,
      state: 'error',
      error: new RealtimeVoiceError(
        'TOKEN_MINT_FAILED',
        'Token mint failed',
        new Error('That key was rejected.'),
      ),
    };

    const view = await renderHome();

    expect(view.getByRole('dialog', { name: 'API key' }).textContent).toBe(
      'That key was rejected.',
    );
  });
});

async function renderHome() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<HomePage />);
  });
  return view;
}

function idleConnector(): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
    subscribe: () => () => {},
    process: () => new Promise(() => {}),
  };
}
