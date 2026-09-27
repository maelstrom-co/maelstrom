// @vitest-environment happy-dom

import type {
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
} from '@maelstrom-co/realtime';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider, voiceProviderStore } from '../lib/voice-provider';
import { HomePage } from './home-page';

const { fixtures, FixtureAdapter } = vi.hoisted(() => {
  const fixtures = {
    adapters: [] as FixtureAdapter[],
    fail: false,
  };

  class FixtureAdapter implements RealtimeProviderAdapter {
    listeners = new Set<(event: RealtimeAdapterEvent) => void>();
    observations = { subscribe: () => () => {} };
    close = () => Promise.resolve();
    starts = 0;
    constructor() {
      if (fixtures.fail) throw new Error('fixture factory failed');
      fixtures.adapters.push(this);
    }
    activateAudio() {}
    async connect(_options: AdapterConnectOptions) {
      this.starts++;
    }
    disconnect() {
      return this.close();
    }
    getAudioStreams() {
      return {};
    }
    injectGrounding() {}
    async sendToolResult() {}
    on(handler: (event: RealtimeAdapterEvent) => void) {
      this.listeners.add(handler);
      return () => {
        this.listeners.delete(handler);
      };
    }
    getTransportSnapshot() {
      return {
        generation: 0,
        state: 'idle',
        finalization: 'pending',
        playback: 'unavailable',
      };
    }
  }
  return { fixtures, FixtureAdapter };
});

vi.mock('@maelstrom-co/realtime-openai', () => ({
  OpenAIAdapter: class extends FixtureAdapter {},
}));
vi.mock('@maelstrom-co/realtime-openai-live', () => ({
  OpenAILiveAdapter: class extends FixtureAdapter {},
}));
vi.mock('@maelstrom-co/realtime-livekit', () => ({
  LiveKitAdapter: class extends FixtureAdapter {},
}));
vi.mock('../lib/connector', () => ({
  createDemoConnector: () => createMockConnector(),
}));
vi.mock('../lib/hosted-vad', () => ({
  HOSTED_VAD_MODEL: 'legacy',
  preloadHostedVadAssets: async () => {},
}));

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '1');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
  fixtures.adapters = [];
  fixtures.fail = false;
  selectVoiceProvider('live');
  setPlaygroundKey('fixture-initial-key-1234567890');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        if (target.classList.contains('demo-layout-host'))
          this.callback(
            [
              {
                target,
                contentRect: { width: 1440, height: 900 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
      }
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  clearPlaygroundKey();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  'remove',
  'replace',
] as const)('keeps the new selection after a key %s retires a pending owner', async (mode) => {
  render(<HomePage />);
  const old = fixtures.adapters[0]!;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  old.close = () => pending;
  fireEvent.change(screen.getByLabelText('Voice provider'), {
    target: { value: 'realtime' },
  });
  expect(screen.getByLabelText('Voice provider').hasAttribute('disabled')).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'API key' }));
  if (mode === 'remove') {
    fireEvent.click(screen.getByRole('button', { name: /remove key/i }));
    fireEvent.change(screen.getByLabelText('Voice provider'), {
      target: { value: 'realtime' },
    });
    fireEvent.change(screen.getByLabelText('Voice provider'), {
      target: { value: 'live' },
    });
  } else {
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'fixture-replacement-key-1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fixtures.adapters).toHaveLength(2));
  }
  expect(voiceProviderStore.state.provider).toBe('live');
  const currentCount = fixtures.adapters.length;
  await act(async () => {
    release();
    await pending;
  });
  expect(voiceProviderStore.state.provider).toBe('live');
  expect(
    screen.getByRole('option', { name: 'GPT-Live', selected: true }),
  ).toBeDefined();
  expect(fixtures.adapters).toHaveLength(currentCount);
  expect(fixtures.adapters.every((adapter) => adapter.starts === 0)).toBe(true);
});

it('shows actionable switch failure without changing the selected mode and allows retry', async () => {
  render(<HomePage />);
  fixtures.fail = true;
  fireEvent.change(screen.getByLabelText('Voice provider'), {
    target: { value: 'realtime' },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toMatch(/switch.*try again/i),
  );
  expect(
    screen.getByRole('option', { name: 'GPT-Live', selected: true }),
  ).toBeDefined();
  expect(voiceProviderStore.state.provider).toBe('live');
  fixtures.fail = false;
  fireEvent.change(screen.getByLabelText('Voice provider'), {
    target: { value: 'realtime' },
  });
  await waitFor(() =>
    expect(voiceProviderStore.state.provider).toBe('realtime'),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fixtures.adapters.every((adapter) => adapter.starts === 0)).toBe(true);
});
