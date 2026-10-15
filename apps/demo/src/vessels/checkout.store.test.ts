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
import { __resetOrdersStoreForTests, getOrdersSnapshot } from './orders.store';

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

  it('numbers consecutive orders upward', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    checkoutActions.placeOrder();
    cartActions.addToCart('CAT-WET-WHISKER-PATE-24');
    const second = checkoutActions.placeOrder();

    expect(second?.order.id).toBe('ORD-10457');
    expect(getOrdersSnapshot().orders.map((order) => order.id)).toEqual([
      'ORD-10457',
      'ORD-10456',
      'ORD-10455',
      'ORD-10421',
      'ORD-10388',
      'ORD-10307',
    ]);
  });
});

describe('checkoutActions.returnToCheckoutReview', () => {
  it('drops the last confirmation without touching the recorded order', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    const confirmation = checkoutActions.placeOrder();
    checkoutActions.returnToCheckoutReview();

    expect(getCheckoutSnapshot().lastConfirmation).toBeNull();
    expect(getOrdersSnapshot().orders[0]).toBe(confirmation?.order);
  });
});
