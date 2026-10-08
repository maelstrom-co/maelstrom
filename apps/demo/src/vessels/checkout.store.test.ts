import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetCartStoreForTests,
  cartActions,
  getCartSnapshot,
} from './cart.store';
import {
  __resetCheckoutStoreForTests,
  checkoutActions,
  getCheckoutSnapshot,
} from './checkout.store';
import {
  __resetOrdersStoreForTests,
  getOrdersSnapshot,
  ordersActions,
} from './orders.store';

beforeEach(() => {
  __resetCartStoreForTests();
  __resetCheckoutStoreForTests();
  __resetOrdersStoreForTests();
});

describe('checkoutActions.placeOrder', () => {
  it('refuses an empty cart and leaves orders untouched', () => {
    const before = getOrdersSnapshot().orders;
    expect(checkoutActions.placeOrder()).toBeNull();
    expect(getOrdersSnapshot().orders).toBe(before);
    expect(getCheckoutSnapshot().lastConfirmation).toBeNull();
  });

  it('turns the cart into a new newest order, empties the cart and keeps a confirmation', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    const confirmation = checkoutActions.placeOrder(new Date(2026, 9, 8));

    expect(confirmation?.order).toEqual({
      id: 'ORD-10456',
      placedOn: '2026-10-08',
      status: 'processing',
      items: [
        {
          sku: 'DOG-DRY-SUMMIT-HW-30',
          name: 'Summit Trail Healthy Weight Chicken & Barley',
          quantity: 1,
          unitPriceCents: 6699,
        },
      ],
      totals: {
        subtotalCents: 6699,
        shippingCents: 0,
        taxCents: 536,
        totalCents: 7235,
      },
    });
    expect(confirmation?.paymentMethod).toBe('Visa ending 4242');
    expect(confirmation?.shipTo).toContain('Portland, OR 97205');
    expect(getOrdersSnapshot().orders[0]).toBe(confirmation?.order);
    expect(getCartSnapshot().lines).toEqual([]);
    expect(getCheckoutSnapshot().lastConfirmation).toBe(confirmation);
  });
});

describe('ordersActions', () => {
  it('opens the most recent order, which holds the usual dog food', () => {
    const latest = ordersActions.showMostRecentOrder();
    expect(latest?.id).toBe('ORD-10455');
    expect(latest?.items.map((item) => item.sku)).toContain(
      'DOG-DRY-SUMMIT-ADULT-30',
    );
    expect(getOrdersSnapshot().selectedOrderId).toBe('ORD-10455');
  });

  it('accepts an order id with or without the ORD- prefix', () => {
    expect(ordersActions.showOrderDetails('10388')?.id).toBe('ORD-10388');
    expect(ordersActions.showOrderDetails('ord-10307')?.id).toBe('ORD-10307');
    expect(ordersActions.showOrderDetails('ORD-1')).toBeNull();
  });
});
