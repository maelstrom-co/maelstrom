// @vitest-environment happy-dom

import {
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  type VesselDefinition,
  VesselId,
} from '@maelstrom-co/protocol';
import type { RealtimeInstance } from '@maelstrom-co/realtime';
import {
  act,
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
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider } from '../lib/voice-provider';
import { shopM } from '../shop/maelstrom';
import {
  __resetCartStoreForTests,
  cartActions,
} from '../shop/stores/cart.store';
import { __resetCatalogStoreForTests } from '../shop/stores/catalog.store';
import {
  __resetCheckoutStoreForTests,
  checkoutActions,
} from '../shop/stores/checkout.store';
import { __resetOrdersStoreForTests } from '../shop/stores/orders.store';

vi.mock('@maelstrom-co/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime')>()),
  RealtimeSession: FakeRealtimeSession,
}));

const openAIAdapter = vi.hoisted(() => ({ activations: 0 }));
vi.mock('@maelstrom-co/realtime-openai', () => ({
  OpenAIAdapter: class {
    activateAudio() {
      openAIAdapter.activations += 1;
    }
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

// Stands in for the Engine and Planner at the connector boundary: every
// ChartRequest is recorded, and a request whose user intent names a known
// screen gets the layout a Planner would return for it.
const engine = vi.hoisted(() => ({
  requests: [] as ChartRequestMessage[],
  layouts: new Map<RegExp, TilingLayout>(),
}));

vi.mock('../lib/connector', () => ({
  createDemoConnector: () => ({
    ...createMockConnector(),
    process: async (message: ChartRequestMessage) => {
      engine.requests.push(message);
      return plannedResponse(message);
    },
  }),
}));

const SHOP_VESSEL_IDS = ['cart', 'catalog', 'checkout', 'orders'];
const SEED_ORDER_IDS = ['ORD-10455', 'ORD-10421', 'ORD-10388', 'ORD-10307'];

const ORDERS = InstanceId('orders-main');
const CART = InstanceId('cart-main');
const CATALOG = InstanceId('catalog-main');
const CHECKOUT = InstanceId('checkout-main');

const CATALOG_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: [
    'V',
    'H',
    tilingLeafToken(ORDERS),
    tilingLeafToken(CART),
    tilingLeafToken(CATALOG),
  ],
  instances: [
    {
      instanceId: ORDERS,
      vesselId: VesselId('orders'),
      variant: VariantName('list'),
    },
    {
      instanceId: CART,
      vesselId: VesselId('cart'),
      variant: VariantName('items'),
    },
    {
      instanceId: CATALOG,
      vesselId: VesselId('catalog'),
      variant: VariantName('results'),
    },
  ],
};

const CHECKOUT_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['V', tilingLeafToken(CART), tilingLeafToken(CHECKOUT)],
  instances: [
    {
      instanceId: CART,
      vesselId: VesselId('cart'),
      variant: VariantName('items'),
    },
    {
      instanceId: CHECKOUT,
      vesselId: VesselId('checkout'),
      variant: VariantName('review'),
    },
  ],
};

class LayoutHostResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    if (!target.classList.contains('demo-layout-host')) return;
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
}

beforeEach(() => {
  selectVoiceProvider('realtime');
  vi.stubEnv('VITE_HOSTED', '1');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
  FakeRealtimeSession.instances = [];
  openAIAdapter.activations = 0;
  engine.requests = [];
  engine.layouts = new Map([
    [/catalog/i, CATALOG_LAYOUT],
    [/check ?out/i, CHECKOUT_LAYOUT],
  ]);
  clearPlaygroundKey();
  resetShopStores();
  vi.stubGlobal('ResizeObserver', LayoutHostResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearPlaygroundKey();
  resetShopStores();
});

describe('shop Vessel catalog', () => {
  it('registers exactly the four shop Vessels on the shop instance', () => {
    expect(shopM.vessels.map((entry) => entry.vessel.id).sort()).toEqual(
      SHOP_VESSEL_IDS,
    );
  });

  it('keeps the shop Vessels out of the home instance', () => {
    const homeIds = m.vessels.map((entry) => entry.vessel.id);
    for (const id of SHOP_VESSEL_IDS) expect(homeIds).not.toContain(id);
  });
});

describe('/shop without a key', () => {
  it('shows the shop preview in its own shell instead of the home preview', async () => {
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    expect(
      screen.getByRole('heading', { name: 'Maelstrom Pet Shop' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Maelstrom Demo' }),
    ).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'Back to the main demo' })
        .getAttribute('href'),
    ).toBe('/');
    expect(screen.getByText('ORD-10455')).toBeTruthy();
    expect(screen.getByText('Your cart is empty.')).toBeTruthy();
    expect(screen.getByRole('status', { name: /key required/i })).toBeTruthy();

    expect(screen.queryByText('Interactive preview')).toBeNull();
    expect(
      screen.queryByText('Arrange a workspace around what you need.'),
    ).toBeNull();
    expect(screen.queryByText('Day view')).toBeNull();
    expect(screen.queryByText('Design review')).toBeNull();
    expect(screen.queryByText('Ship this sprint')).toBeNull();
    expect(engine.requests).toHaveLength(0);
  });

  it('opens the key drawer from the shop preview', async () => {
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Start interactive demo' }),
    );

    expect(screen.getByLabelText('API key')).toBeTruthy();
  });

  it('starts selected Realtime voice on the shop session after the first key save', async () => {
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Start interactive demo' }),
    );
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-shop-first-key-1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(FakeRealtimeSession.instances.at(-1)?.connectCalls).toBe(1);
    });
    expect(openAIAdapter.activations).toBe(1);
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Voice status' }).textContent,
      ).toBe('Listening'),
    );
    expect(
      realtimeInstance(must(FakeRealtimeSession.instances.at(-1)))
        .getCapabilitySnapshot()
        .vessels.map((vessel) => vessel.vesselId)
        .sort(),
    ).toEqual(SHOP_VESSEL_IDS);
  });

  it('holds a typed intent behind the key drawer and sends it once the key is saved', async () => {
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    fireEvent.change(screen.getByLabelText('Ask the pet shop'), {
      target: { value: 'show the catalog' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add key' }));
    expect(screen.getByLabelText('API key')).toBeTruthy();
    expect(engine.requests).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-shop-held-intent-1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(instance(CATALOG)).not.toBeNull(), {
      timeout: 2000,
    });
    expect(intentRequest('show the catalog')).toBeDefined();
  });
});

describe('/shop with a key', () => {
  it('starts on orders beside the cart, with the catalog left for the Planner', async () => {
    setPlaygroundKey('sk-shop-start-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    expect(instance(ORDERS)).not.toBeNull();
    expect(instance(CART)).not.toBeNull();
    expect(instance(CATALOG)).toBeNull();
    expect(instance(CHECKOUT)).toBeNull();
  });

  it('keeps the voice and key chrome under its own header copy', async () => {
    setPlaygroundKey('sk-shop-header-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    expect(
      screen.getByRole('heading', { name: 'Maelstrom Pet Shop' }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Back to the main demo' })
        .getAttribute('href'),
    ).toBe('/');
    expect(screen.getByRole('button', { name: 'API key' })).toBeTruthy();
    expect(
      await screen.findByRole('status', {
        name: 'Connection status: connected',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start voice' })).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'Voice status' }).textContent,
    ).toBe('Tap to talk');
    expect(screen.getByTestId('ai-voice-disclosure').textContent).toBe(
      'AI-generated voice',
    );
    expect(FakeRealtimeSession.instances.length).toBeGreaterThan(0);
  });

  it('keeps the voice corner outside the Chart host', async () => {
    setPlaygroundKey('sk-shop-corner-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    const { container } = render(<ShopPage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    const chartHost = must(container.querySelector('.chart-wrapper'));
    const corner = must(container.querySelector('.shop-voice-corner'));
    expect(chartHost.contains(corner)).toBe(false);
    expect(chartHost.contains(screen.getByTestId('shop-caption'))).toBe(false);
  });

  it('prepares browser voice inside the orb tap before connecting', async () => {
    setPlaygroundKey('sk-shop-orb-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    });

    expect(openAIAdapter.activations).toBe(1);
    await waitFor(() =>
      expect(FakeRealtimeSession.instances.at(-1)?.connectCalls).toBe(1),
    );
  });

  it('reopens the key drawer when voice cannot mint a token with the key', async () => {
    setPlaygroundKey('sk-shop-rejected-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    const { RealtimeVoiceError } = await import('@maelstrom-co/realtime');
    render(<ShopPage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    expect(screen.queryByLabelText('API key')).toBeNull();

    const session = must(FakeRealtimeSession.instances.at(-1));
    session.lastError = new RealtimeVoiceError(
      'TOKEN_MINT_FAILED',
      'Failed to mint an ephemeral realtime token',
      new Error('Invalid API key.'),
    );
    await act(async () => {
      session.emitState('error');
    });

    await waitFor(() => expect(screen.getByLabelText('API key')).toBeTruthy());
    expect(screen.getByText('Invalid API key.')).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'Voice status' }).textContent,
    ).toBe('Voice error');
  });

  it('offers the shop examples as intent suggestions', async () => {
    setPlaygroundKey('sk-shop-examples-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    const { SHOP_INTENT_EXAMPLES } = await import('../shop/shop-intent-form');
    render(<ShopPage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    const suggestions = Array.from(
      document.querySelectorAll('#shop-intent-examples option'),
      (option) => option.getAttribute('value'),
    );
    expect(suggestions).toEqual([...SHOP_INTENT_EXAMPLES]);
    expect(suggestions).toEqual([
      'show the catalog',
      'reorder my dog food but with less fat',
      'check out',
    ]);
  });

  it('brings the catalog in through the Planner when "show the catalog" is typed', async () => {
    setPlaygroundKey('sk-shop-typed-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    await submitTypedIntent('show the catalog');

    await waitFor(() => expect(instance(CATALOG)).not.toBeNull(), {
      timeout: 2000,
    });
    const request = must(intentRequest('show the catalog'));
    expect(request.request.vessels.map((vessel) => vessel.id).sort()).toEqual(
      SHOP_VESSEL_IDS,
    );
    await waitFor(() =>
      expect(instance(CATALOG)?.textContent).toContain('Full catalog'),
    );
  });

  it('sends a voice intent through the shop instance createIntentScope and offers voice only the shop Vessels', async () => {
    setPlaygroundKey('sk-shop-voice-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    const voice = realtimeInstance(must(FakeRealtimeSession.instances.at(-1)));

    expect(
      voice
        .getCapabilitySnapshot()
        .vessels.map((vessel) => vessel.vesselId)
        .sort(),
    ).toEqual(SHOP_VESSEL_IDS);

    const scope = must(voice.createIntentScope?.());
    await act(async () => {
      await scope.enqueueIntent('show the catalog').result;
    });

    await waitFor(() => expect(instance(CATALOG)).not.toBeNull(), {
      timeout: 2000,
    });
    const request = must(intentRequest('show the catalog'));
    expect(request.request.vessels.map((vessel) => vessel.id).sort()).toEqual(
      SHOP_VESSEL_IDS,
    );
  });

  it('adds a product to the cart and places the order by hand, ending on the confirmation', async () => {
    setPlaygroundKey('sk-shop-by-hand-1234567890');
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    await submitTypedIntent('show the catalog');
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Summit Trail Healthy Weight Chicken & Barley' },
        { timeout: 2000 },
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add to cart' }));
    await waitFor(() =>
      expect(instance(CART)?.textContent).toContain(
        'Summit Trail Healthy Weight Chicken & Barley',
      ),
    );

    await submitTypedIntent('check out');
    const placeOrder = await screen.findByRole(
      'button',
      { name: 'Place order' },
      { timeout: 2000 },
    );
    await waitFor(() =>
      expect((placeOrder as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(placeOrder);

    await waitFor(() => {
      const checkout = must(instance(CHECKOUT));
      expect(checkout.textContent).toContain('Order placed');
      expect(checkout.textContent).toContain('ORD-10456');
      expect(checkout.textContent).toContain('Demo order, nothing charged');
    });
    expect(instance(CART)?.textContent).toContain('Your cart is empty');
  });

  it('publishes real order ids and cart SKUs as action options', async () => {
    setPlaygroundKey('sk-shop-options-1234567890');
    const updateVesselSpy = vi.spyOn(shopM, 'updateVessel');
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    await waitFor(
      () =>
        expect(
          acceptedEnum(
            updateVesselSpy,
            'orders',
            'showOrderDetails',
            'orderId',
          ),
        ).toEqual({ published: true, enum: SEED_ORDER_IDS }),
      { timeout: 2000 },
    );
    await waitFor(() => expectNoCartSkuEnum(updateVesselSpy), {
      timeout: 2000,
    });

    act(() => {
      cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    });

    await waitFor(
      () =>
        expect(
          acceptedEnum(updateVesselSpy, 'cart', 'removeFromCart', 'sku'),
        ).toEqual({ published: true, enum: ['DOG-DRY-SUMMIT-HW-30'] }),
      { timeout: 2000 },
    );
    expect(
      acceptedEnum(updateVesselSpy, 'cart', 'updateCartQuantity', 'sku'),
    ).toEqual({ published: true, enum: ['DOG-DRY-SUMMIT-HW-30'] });
    expect(
      acceptedEnum(updateVesselSpy, 'cart', 'addToCart', 'sku')?.enum,
    ).toContain('DOG-DRY-NORTHPAW-LEAN-28');

    act(() => {
      cartActions.clearCart();
    });

    await waitFor(() => expectNoCartSkuEnum(updateVesselSpy), {
      timeout: 2000,
    });
  });

  it('republishes the order ids with a newly placed order first', async () => {
    setPlaygroundKey('sk-shop-new-order-1234567890');
    const updateVesselSpy = vi.spyOn(shopM, 'updateVessel');
    const { ShopPage } = await import('../shop/shop-page');
    render(<ShopPage />);

    await waitFor(
      () =>
        expect(
          acceptedEnum(
            updateVesselSpy,
            'orders',
            'showOrderDetails',
            'orderId',
          ),
        ).toEqual({ published: true, enum: SEED_ORDER_IDS }),
      { timeout: 2000 },
    );

    act(() => {
      cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
      checkoutActions.placeOrder();
    });

    await waitFor(
      () =>
        expect(
          acceptedEnum(
            updateVesselSpy,
            'orders',
            'showOrderDetails',
            'orderId',
          ),
        ).toEqual({ published: true, enum: ['ORD-10456', ...SEED_ORDER_IDS] }),
      { timeout: 2000 },
    );
  });
});

function plannedResponse(message: ChartRequestMessage): MaelstromResponse {
  const intents = message.request.context.updateReasons.flatMap((reason) =>
    reason.type === 'user_intent' ? [reason.intent] : [],
  );
  const planned = [...engine.layouts].find(([pattern]) =>
    intents.some((intent) => pattern.test(intent)),
  )?.[1];
  return {
    type: 'maelstrom_response',
    requestId: message.id,
    userMessage: '',
    rationale: '',
    executionPlan: [],
    layout: planned ?? message.request.layout,
  };
}

async function submitTypedIntent(intent: string): Promise<void> {
  await screen.findByRole('status', {
    name: 'Connection status: connected',
  });
  fireEvent.change(screen.getByLabelText('Ask the pet shop'), {
    target: { value: intent },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

function intentRequest(intent: string): ChartRequestMessage | undefined {
  return engine.requests.find((message) =>
    message.request.context.updateReasons.some(
      (reason) => reason.type === 'user_intent' && reason.intent === intent,
    ),
  );
}

function instance(instanceId: InstanceId): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-instance-id="${instanceId}"]`,
  );
}

function realtimeInstance(session: FakeRealtimeSession): RealtimeInstance {
  return (session.options as { instance: RealtimeInstance }).instance;
}

interface UpdateVesselSpy {
  mock: { calls: unknown[][]; results: { value: unknown }[] };
}

// The parameter's enum in the latest accepted republish for a Vessel, or
// undefined before any republish is accepted. A refused one (for example
// while a command batch is in flight) is retried and must not count.
function acceptedEnum(
  spy: UpdateVesselSpy,
  vesselId: string,
  action: string,
  parameter: string,
):
  | { readonly published: true; readonly enum?: readonly unknown[] }
  | undefined {
  const accepted = spy.mock.calls.filter(
    ([vessel], i) =>
      (vessel as VesselDefinition).id === vesselId &&
      (spy.mock.results[i]?.value as { ok?: boolean } | undefined)?.ok === true,
  );
  const vessel = accepted.at(-1)?.[0] as VesselDefinition | undefined;
  if (!vessel) return undefined;
  for (const variant of Object.values(vessel.variants)) {
    const found = variant.actions
      .find((candidate) => candidate.name === action)
      ?.parameters?.find((candidate) => candidate.name === parameter);
    if (found) {
      return found.enum === undefined
        ? { published: true }
        : { published: true, enum: found.enum };
    }
  }
  throw new Error(`${vesselId} declares no ${action}.${parameter} parameter`);
}

function expectNoCartSkuEnum(spy: UpdateVesselSpy): void {
  expect(acceptedEnum(spy, 'cart', 'removeFromCart', 'sku')).toStrictEqual({
    published: true,
  });
  expect(acceptedEnum(spy, 'cart', 'updateCartQuantity', 'sku')).toStrictEqual({
    published: true,
  });
}

function resetShopStores(): void {
  __resetCartStoreForTests();
  __resetCatalogStoreForTests();
  __resetCheckoutStoreForTests();
  __resetOrdersStoreForTests();
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}
