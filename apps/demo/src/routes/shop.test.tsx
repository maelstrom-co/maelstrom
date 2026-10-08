// @vitest-environment happy-dom

import type { ChartRequestMessage } from '@maelstrom-co/protocol';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import { m } from '../lib/maelstrom';
import { shop } from '../lib/pet-shop-maelstrom';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider } from '../lib/voice-provider';

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
  mintToken: async () => {
    throw new Error('mintToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

vi.mock('../lib/hosted-vad', () => ({
  HOSTED_VAD_MODEL: 'legacy',
  preloadHostedVadAssets: async () => {},
}));

const sent = vi.hoisted(() => ({ requests: [] as unknown[] }));

vi.mock('../lib/connector', () => ({
  createDemoConnector: () => {
    const base = createMockConnector();
    return {
      ...base,
      process: (message: Parameters<typeof base.process>[0]) => {
        sent.requests.push(message);
        return base.process(message);
      },
    };
  },
}));

const SHOP_VESSEL_IDS = ['cart', 'catalog', 'checkout', 'orders'];

class LayoutHostResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    const isLayoutHost = target.classList.contains('demo-layout-host');
    const isChartContainer =
      target.parentElement?.classList.contains('chart-wrapper');
    if (!isLayoutHost && !isChartContainer) return;
    this.callback(
      [
        {
          target,
          contentRect: { width: 1440, height: isLayoutHost ? 900 : 760 },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  selectVoiceProvider('realtime');
  vi.stubEnv('VITE_HOSTED', '1');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
  FakeRealtimeSession.instances = [];
  sent.requests = [];
  clearPlaygroundKey();
  vi.stubGlobal('ResizeObserver', LayoutHostResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearPlaygroundKey();
});

describe('pet-shop vessel catalog', () => {
  it('registers exactly the four shop vessels on the shop instance', () => {
    expect(shop.vessels.map((entry) => entry.vessel.id).sort()).toEqual(
      SHOP_VESSEL_IDS,
    );
  });

  it('keeps the shop vessels out of the home catalog', () => {
    const homeIds = m.vessels.map((entry) => entry.vessel.id);
    for (const id of SHOP_VESSEL_IDS) expect(homeIds).not.toContain(id);
  });
});

describe('/shop page', () => {
  it('starts on the shop layout, in the shop palette, with the home voice chrome', async () => {
    setPlaygroundKey('sk-shop-page-1234567890');
    const { ShopPage } = await import('../components/shop-page');
    const { container } = render(<ShopPage />);

    await waitFor(() => {
      for (const id of SHOP_VESSEL_IDS) {
        expect(
          container.querySelector(`[data-instance-id="${id}-main"]`),
        ).not.toBeNull();
      }
    });
    expect(
      container
        .querySelector('.demo-layout-host')
        ?.getAttribute('data-demo-theme'),
    ).toBe('shop');
    expect(screen.getByTestId('ai-voice-disclosure')).toBeTruthy();
    expect(FakeRealtimeSession.instances.length).toBeGreaterThan(0);
  });

  it('sends only the shop vessels to the Engine', async () => {
    setPlaygroundKey('sk-shop-page-1234567890');
    const { ShopPage } = await import('../components/shop-page');
    render(<ShopPage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'Show me my past orders' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sent.requests.length).toBeGreaterThan(0));
    for (const message of sent.requests as ChartRequestMessage[]) {
      expect(message.request.vessels.map((vessel) => vessel.id).sort()).toEqual(
        SHOP_VESSEL_IDS,
      );
    }
  });
});
