// @vitest-environment happy-dom

import type { VesselDefinition } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_SKUS } from '../stores/fixtures';
import { cartVessel } from './cart.vessel.def';
import { catalogVessel } from './catalog.vessel.def';
import { checkoutVessel } from './checkout.vessel.def';
import { ordersVessel } from './orders.vessel.def';

type Handler = (params?: Record<string, unknown>) => Promise<{
  ok: boolean;
  error?: Error;
}>;

const handlers = new Map<string, Record<string, Handler>>();

const SHOP_VESSELS: Readonly<Record<string, VesselDefinition>> = {
  orders: ordersVessel,
  catalog: catalogVessel,
  cart: cartVessel,
  checkout: checkoutVessel,
};

vi.mock('../maelstrom', () => ({
  shopM: {
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
  '../stores/cart.store'
);
const { __resetCatalogStoreForTests, getCatalogSnapshot } = await import(
  '../stores/catalog.store'
);
const { __resetCheckoutStoreForTests } = await import(
  '../stores/checkout.store'
);
const { __resetOrdersStoreForTests, getOrdersSnapshot } = await import(
  '../stores/orders.store'
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
    expect(
      within(orders.container).getByText('DOG-DRY-SUMMIT-ADULT-30'),
    ).toBeTruthy();

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
    expect(
      within(catalog.container).getByText('Northpaw Lean Turkey & Oatmeal'),
    ).toBeTruthy();

    expect(
      await invoke('cart', 'addToCart', { sku: 'DOG-DRY-SUMMIT-HW-30' }),
    ).toMatchObject({ ok: true });
    expect(
      within(cart.container).getByText(
        'Summit Trail Healthy Weight Chicken & Barley',
      ),
    ).toBeTruthy();

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
    expect(confirmation.getByText(/Visa ending 4242/).textContent).toBe(
      'Demo order, nothing charged (Visa ending 4242 on file)',
    );
    expect(confirmation.queryByText(/Charged to/)).toBeNull();
  });

  it('returns descriptive errors the model can recover from', async () => {
    render(<OrdersComponent {...props<TypedVesselProps<never>>('list')} />);
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

    const badFoodType = await invoke('catalog', 'searchProducts', {
      foodType: 'raw',
    });
    expect(badFoodType?.error?.message).toContain('"dry" or "wet"');

    const unknownOrder = await invoke('orders', 'showOrderDetails', {
      orderId: 'ORD-1',
    });
    expect(unknownOrder?.error?.message).toContain(
      'ORD-10455, ORD-10421, ORD-10388, ORD-10307',
    );

    const unknownProduct = await invoke('cart', 'addToCart', {
      sku: 'NOT-A-SKU',
    });
    expect(unknownProduct?.error?.message).toContain(CATALOG_SKUS.join(', '));

    const unknownFromCatalog = await invoke('catalog', 'addToCart', {
      sku: 'NOT-A-SKU',
    });
    expect(unknownFromCatalog?.error?.message).toContain(
      CATALOG_SKUS.join(', '),
    );

    const zeroToAdd = await invoke('cart', 'addToCart', {
      sku: 'DOG-DRY-SUMMIT-HW-30',
      quantity: 0,
    });
    expect(zeroToAdd?.error?.message).toBe(
      'quantity must be a whole number of at least 1, got 0',
    );

    const notInCart = await invoke('cart', 'removeFromCart', {
      sku: 'DOG-DRY-SUMMIT-HW-30',
    });
    expect(notInCart?.error?.message).toContain('not in the cart');

    const emptyCheckout = await invoke('checkout', 'placeOrder');
    expect(emptyCheckout?.error?.message).toContain('cart is empty');

    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    const negativeUpdate = await invoke('cart', 'updateCartQuantity', {
      sku: 'DOG-DRY-SUMMIT-HW-30',
      quantity: -1,
    });
    expect(negativeUpdate?.error?.message).toBe(
      'quantity must be a whole number of 0 or more (0 removes the line), got -1',
    );
  });

  it('lower-cases the species before searching', async () => {
    render(<CatalogComponent {...props<TypedVesselProps<never>>('results')} />);
    expect(
      await invoke('catalog', 'searchProducts', { species: 'Dog' }),
    ).toMatchObject({ ok: true });
    expect(getCatalogSnapshot().view).toMatchObject({
      kind: 'search',
      criteria: { species: 'dog' },
    });
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

  it('adds the open product to the cart through the catalog addToCart runner', async () => {
    const catalogProps = props<TypedVesselProps<never>>('product');
    const catalog = render(<CatalogComponent {...catalogProps} />);
    expect(
      await invoke('catalog', 'showProductDetails', {
        sku: 'DOG-DRY-SUMMIT-HW-30',
      }),
    ).toMatchObject({ ok: true });

    fireEvent.click(catalog.getByRole('button', { name: 'Add to cart' }));
    expect(catalogProps.executeAction).toHaveBeenCalledWith('addToCart', {
      sku: 'DOG-DRY-SUMMIT-HW-30',
    });
    expect(getCartSnapshot().lines).toEqual([]);

    for (let i = 0; i < 2; i++) {
      expect(
        await invoke('catalog', 'addToCart', { sku: 'DOG-DRY-SUMMIT-HW-30' }),
      ).toMatchObject({ ok: true });
    }
    expect(getCartSnapshot().lines).toEqual([
      expect.objectContaining({ sku: 'DOG-DRY-SUMMIT-HW-30', quantity: 2 }),
    ]);
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

describe('pet-shop vessel action runners', () => {
  it('registers a runner for every action each vessel definition declares', () => {
    render(<OrdersComponent {...props<TypedVesselProps<never>>('list')} />);
    render(<CatalogComponent {...props<TypedVesselProps<never>>('results')} />);
    render(<CartComponent {...props<TypedVesselProps<never>>('items')} />);
    render(<CheckoutComponent {...props<TypedVesselProps<never>>('review')} />);

    const registered = Object.fromEntries(
      Object.keys(SHOP_VESSELS).map((vesselId) => [
        vesselId,
        Object.keys(handlers.get(vesselId) ?? {}).sort(),
      ]),
    );
    const declared = Object.fromEntries(
      Object.entries(SHOP_VESSELS).map(([vesselId, vessel]) => [
        vesselId,
        declaredActionNames(vessel),
      ]),
    );
    expect(registered).toEqual(declared);
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

function declaredActionNames(vessel: VesselDefinition): string[] {
  const names = Object.values(vessel.variants).flatMap((variant) =>
    variant.actions.map((action) => action.name),
  );
  return [...new Set(names)].sort();
}
