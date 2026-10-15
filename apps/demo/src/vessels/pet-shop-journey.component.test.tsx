// @vitest-environment happy-dom

import type { TypedVesselProps } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (params?: Record<string, unknown>) => Promise<{
  ok: boolean;
  error?: Error;
}>;

const handlers = new Map<string, Record<string, Handler>>();

vi.mock('../lib/pet-shop-maelstrom', () => ({
  shop: {
    useActions: (
      vesselId: string,
      _instanceId: string,
      runners: Record<string, Handler>,
    ) => {
      handlers.set(vesselId, runners);
    },
  },
}));

const { __resetCartStoreForTests, cartActions, getCartSnapshot } = await import(
  './cart.store'
);
const { __resetCatalogStoreForTests, getCatalogSnapshot } = await import(
  './catalog.store'
);
const { __resetCheckoutStoreForTests } = await import('./checkout.store');
const { __resetOrdersStoreForTests, getOrdersSnapshot } = await import(
  './orders.store'
);
const OrdersComponent = (await import('./orders.component')).default;
const CatalogComponent = (await import('./catalog.component')).default;
const CartComponent = (await import('./cart.component')).default;
const CheckoutComponent = (await import('./checkout.component')).default;

beforeEach(() => {
  handlers.clear();
  __resetCartStoreForTests();
  __resetCatalogStoreForTests();
  __resetCheckoutStoreForTests();
  __resetOrdersStoreForTests();
});

afterEach(cleanup);

describe('pet-food reorder journey through the vessel action handlers', () => {
  it('reviews the last order, finds a lower-fat alternative, adds it and checks out', async () => {
    const orders = render(
      <OrdersComponent {...props<TypedVesselProps<never>>('detail')} />,
    );
    const catalog = render(
      <CatalogComponent {...props<TypedVesselProps<never>>('results')} />,
    );
    const cart = render(
      <CartComponent {...props<TypedVesselProps<never>>('items')} />,
    );
    render(<CheckoutComponent {...props<TypedVesselProps<never>>('review')} />);

    expect(await invoke('orders', 'showMostRecentOrder')).toMatchObject({
      ok: true,
    });
    expect(orders.getByText('DOG-DRY-SUMMIT-ADULT-30')).toBeTruthy();

    expect(
      await invoke('catalog', 'findSimilarProducts', {
        sku: 'DOG-DRY-SUMMIT-ADULT-30',
        lowerFatOnly: true,
      }),
    ).toMatchObject({ ok: true });
    expect(getCatalogSnapshot().results.map((p) => p.sku)).toEqual([
      'DOG-DRY-NORTHPAW-LEAN-28',
      'DOG-DRY-SUMMIT-HW-30',
      'DOG-DRY-HARVEST-SENS-30',
    ]);
    expect(catalog.getByText('Northpaw Lean Turkey & Oatmeal')).toBeTruthy();

    expect(
      await invoke('cart', 'addToCart', { sku: 'DOG-DRY-SUMMIT-HW-30' }),
    ).toMatchObject({ ok: true });
    expect(
      cart.getAllByText('Summit Trail Healthy Weight Chicken & Barley').length,
    ).toBeGreaterThan(0);

    expect(await invoke('checkout', 'placeOrder')).toMatchObject({ ok: true });
    expect(getCartSnapshot().lines).toEqual([]);
    expect(getOrdersSnapshot().orders[0]?.items[0]?.sku).toBe(
      'DOG-DRY-SUMMIT-HW-30',
    );
  });

  it('shows the placed order on the checkout confirmation variant', async () => {
    render(<CheckoutComponent {...props<TypedVesselProps<never>>('review')} />);
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    expect(await invoke('checkout', 'placeOrder')).toMatchObject({ ok: true });
    cleanup();

    const confirmation = render(
      <CheckoutComponent {...props<TypedVesselProps<never>>('confirmation')} />,
    );
    expect(confirmation.getByText('Order placed')).toBeTruthy();
    expect(confirmation.getByText('ORD-10456')).toBeTruthy();
    expect(confirmation.getByText(/Visa ending 4242/)).toBeTruthy();
  });

  it('returns descriptive errors the model can recover from', async () => {
    render(<CatalogComponent {...props<TypedVesselProps<never>>('results')} />);
    render(<CartComponent {...props<TypedVesselProps<never>>('items')} />);
    render(<CheckoutComponent {...props<TypedVesselProps<never>>('review')} />);

    const unknown = await invoke('catalog', 'findSimilarProducts', {
      sku: 'NOT-A-SKU',
    });
    expect(unknown?.ok).toBe(false);
    expect(unknown?.error?.message).toContain('DOG-DRY-SUMMIT-ADULT-30');

    const badSpecies = await invoke('catalog', 'searchProducts', {
      species: 'hamster',
    });
    expect(badSpecies?.error?.message).toContain('"dog" or "cat"');

    const notInCart = await invoke('cart', 'removeFromCart', {
      sku: 'DOG-DRY-SUMMIT-HW-30',
    });
    expect(notInCart?.error?.message).toContain('not in the cart');

    const emptyCheckout = await invoke('checkout', 'placeOrder');
    expect(emptyCheckout?.error?.message).toContain('cart is empty');
  });
});

describe('pet-shop vessels by hand', () => {
  it('routes the cart quantity buttons and Place order through executeAction', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    const cartProps = props<TypedVesselProps<never>>('items');
    const checkoutProps = props<TypedVesselProps<never>>('review');
    const cart = render(<CartComponent {...cartProps} />);
    const checkout = render(<CheckoutComponent {...checkoutProps} />);

    fireEvent.click(
      cart.getByLabelText(
        'Increase Summit Trail Healthy Weight Chicken & Barley',
      ),
    );
    expect(cartProps.executeAction).toHaveBeenCalledWith('updateCartQuantity', {
      sku: 'DOG-DRY-SUMMIT-HW-30',
      quantity: 2,
    });

    fireEvent.click(checkout.getByRole('button', { name: 'Place order' }));
    expect(checkoutProps.executeAction).toHaveBeenCalledWith('placeOrder');
  });

  it('disables Place order while the cart is empty', () => {
    const checkout = render(
      <CheckoutComponent {...props<TypedVesselProps<never>>('review')} />,
    );
    const button = checkout.getByRole('button', {
      name: 'Place order',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

function props<P>(variant: string): P {
  return {
    instanceId: 'test',
    variantProps: { variant },
    executeAction: vi.fn(),
  } as unknown as P;
}

async function invoke(
  vesselId: string,
  action: string,
  params?: Record<string, unknown>,
) {
  const handler = handlers.get(vesselId)?.[action];
  if (!handler) throw new Error(`${vesselId}.${action} is not registered`);
  let result: Awaited<ReturnType<Handler>> | undefined;
  await act(async () => {
    result = await handler(params);
  });
  return result;
}
