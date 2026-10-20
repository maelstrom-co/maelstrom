// @vitest-environment happy-dom

import { createMaelstrom } from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools/production';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import { DEFAULT_LAYOUT, NARROW_LAYOUT } from '../lib/default-layout';
import { demoRealtime } from '../lib/demo-realtime';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { m } from '../lib/maelstrom';
import { orchestrationLegibility } from '../lib/orchestration-legibility';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider } from '../lib/voice-provider';
import { DemoWorkspace, type KeylessFallbackProps } from './demo-workspace';

vi.mock('@maelstrom-co/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime')>()),
  RealtimeSession: FakeRealtimeSession,
}));
vi.mock('@maelstrom-co/realtime-openai', () => ({
  OpenAIAdapter: class {
    activateAudio() {}
  },
}));
vi.mock('../lib/mint-token', () => ({
  mintOpenAIToken: async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));
vi.mock('../lib/hosted-vad', () => ({
  HOSTED_VAD_MODEL: 'legacy',
  preloadHostedVadAssets: async () => {},
}));
vi.mock('../lib/connector', () => ({
  createDemoConnector: () => createMockConnector(),
}));

const EXAMPLES = ['Plan my afternoon', 'Hide the weather'];

let layoutHostWidth = 1440;

class LayoutHostResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    if (!target.classList.contains('demo-layout-host')) return;
    this.callback(
      [
        {
          target,
          contentRect: { width: layoutHostWidth, height: 900 },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  disconnect() {}
  unobserve() {}
}

function OptionSyncMarker() {
  const { connectionStatus } = m.useMaelstrom();
  return <span data-testid="option-sync">{connectionStatus}</span>;
}

function KeylessFallback({ onRequireKey }: KeylessFallbackProps) {
  return (
    <button type="button" onClick={onRequireKey}>
      Custom key-less fallback
    </button>
  );
}

function renderWorkspace(
  initialLayout = vi.fn((hostWidth: number) =>
    hostWidth <= 640 ? NARROW_LAYOUT : DEFAULT_LAYOUT,
  ),
) {
  render(
    <DemoWorkspace
      maelstrom={m}
      initialLayout={initialLayout}
      OptionSync={OptionSyncMarker}
      examples={EXAMPLES}
      KeylessFallback={KeylessFallback}
    />,
  );
  return { initialLayout };
}

beforeEach(() => {
  selectVoiceProvider('realtime');
  vi.stubEnv('VITE_HOSTED', '1');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
  FakeRealtimeSession.instances = [];
  layoutHostWidth = 1440;
  clearPlaygroundKey();
  vi.stubGlobal('ResizeObserver', LayoutHostResizeObserver);
});

afterEach(() => {
  cleanup();
  clearPlaygroundKey();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('DemoWorkspace', () => {
  it('renders the configured key-less fallback instead of the home preview', () => {
    renderWorkspace();

    expect(
      screen.getByRole('button', { name: 'Custom key-less fallback' }),
    ).toBeTruthy();
    expect(screen.queryByText('Interactive preview')).toBeNull();
    expect(screen.queryByTestId('option-sync')).toBeNull();
  });

  it('mounts the configured instance with its option sync, start layout and examples once a key is present', async () => {
    setPlaygroundKey('sk-test');
    const { initialLayout } = renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('option-sync').textContent).toBe('connected');
    });
    expect(initialLayout).toHaveBeenCalledWith(1440);
    expect(
      document.querySelector('[data-instance-id="calendar-main"]'),
    ).not.toBeNull();
    const suggestions = Array.from(
      document.querySelectorAll('#demo-intent-examples option'),
      (option) => option.getAttribute('value'),
    );
    expect(suggestions).toEqual(EXAMPLES);
    expect(
      screen.queryByRole('button', { name: 'Custom key-less fallback' }),
    ).toBeNull();
  });

  it('asks for the start layout at the measured host width', async () => {
    setPlaygroundKey('sk-test');
    layoutHostWidth = 600;
    const { initialLayout } = renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('option-sync')).toBeTruthy();
    });
    expect(initialLayout).toHaveBeenCalledWith(600);
  });

  it('renders the shared chrome from a second, vessel-less instance', async () => {
    setPlaygroundKey('sk-test');
    const other = createMaelstrom({ vessels: [] })
      .with(demoRealtime())
      .with(orchestrationLegibility)
      .with(devtools({ capture: diagnosticCapture }));
    function OtherOptionSync() {
      const { connectionStatus } = other.useMaelstrom();
      return <span data-testid="option-sync">{connectionStatus}</span>;
    }

    render(
      <DemoWorkspace
        maelstrom={other}
        initialLayout={() => ({ type: 'tiling', tree: [], instances: [] })}
        OptionSync={OtherOptionSync}
        examples={EXAMPLES}
        KeylessFallback={KeylessFallback}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('option-sync').textContent).toBe('connected');
    });
    const hint = screen.getByTestId('first-run-hint');
    for (const example of EXAMPLES) {
      expect(hint.textContent).toContain(example);
    }
    expect(
      document.querySelector('[data-instance-id="calendar-main"]'),
    ).toBeNull();
    const suggestions = Array.from(
      document.querySelectorAll('#demo-intent-examples option'),
      (option) => option.getAttribute('value'),
    );
    expect(suggestions).toEqual(EXAMPLES);
    expect(screen.getByLabelText('Voice provider')).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'Connection status: connected' }),
    ).toBeTruthy();
  });
});
