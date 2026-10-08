import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetCartStoreForTests,
  cartActions,
  cartTotals,
  getCartSnapshot,
} from './cart.store';

beforeEach(() => {
  __resetCartStoreForTests();
});

describe('cartActions', () => {
  it('adds a product with its catalog name and price', () => {
    expect(cartActions.addToCart('DOG-DRY-SUMMIT-HW-30')).toEqual({
      ok: true,
      line: {
        sku: 'DOG-DRY-SUMMIT-HW-30',
        name: 'Summit Trail Healthy Weight Chicken & Barley',
        quantity: 1,
        unitPriceCents: 6699,
      },
    });
  });

  it('increments the quantity when the same product is added again', () => {
    cartActions.addToCart('CAT-WET-WHISKER-PATE-24', 2);
    cartActions.addToCart('cat-wet-whisker-pate-24');
    expect(getCartSnapshot().lines).toEqual([
      expect.objectContaining({ sku: 'CAT-WET-WHISKER-PATE-24', quantity: 3 }),
    ]);
  });

  it('rejects unknown products and non-positive or fractional quantities', () => {
    expect(cartActions.addToCart('NOPE-1')).toEqual({
      ok: false,
      reason: 'unknown_product',
    });
    expect(cartActions.addToCart('DOG-DRY-SUMMIT-HW-30', 0)).toEqual({
      ok: false,
      reason: 'bad_quantity',
    });
    expect(cartActions.addToCart('DOG-DRY-SUMMIT-HW-30', 1.5)).toEqual({
      ok: false,
      reason: 'bad_quantity',
    });
    expect(getCartSnapshot().lines).toEqual([]);
  });

  it('sets an absolute quantity and removes the line at zero', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    cartActions.updateCartQuantity('DOG-DRY-SUMMIT-HW-30', 4);
    expect(getCartSnapshot().lines[0]?.quantity).toBe(4);
    cartActions.updateCartQuantity('DOG-DRY-SUMMIT-HW-30', 0);
    expect(getCartSnapshot().lines).toEqual([]);
  });

  it('reports not_in_cart when removing or updating a product that is not there', () => {
    expect(cartActions.removeFromCart('DOG-DRY-SUMMIT-HW-30')).toEqual({
      ok: false,
      reason: 'not_in_cart',
    });
    expect(cartActions.updateCartQuantity('DOG-DRY-SUMMIT-HW-30', 2)).toEqual({
      ok: false,
      reason: 'not_in_cart',
    });
  });
});

describe('cartTotals', () => {
  it('charges flat shipping below the free-shipping threshold', () => {
    cartActions.addToCart('CAT-WET-NORTHPAW-SHRED-12');
    expect(cartTotals()).toEqual({
      subtotalCents: 2199,
      shippingCents: 599,
      taxCents: 176,
      totalCents: 2974,
    });
  });

  it('ships free at or above the threshold and sums every line', () => {
    cartActions.addToCart('DOG-DRY-SUMMIT-HW-30');
    cartActions.addToCart('CAT-WET-WHISKER-PATE-24', 2);
    expect(cartTotals()).toEqual({
      subtotalCents: 6699 + 2 * 2799,
      shippingCents: 0,
      taxCents: Math.round((6699 + 2 * 2799) * 0.08),
      totalCents: 6699 + 2 * 2799 + Math.round((6699 + 2 * 2799) * 0.08),
    });
  });

  it('is all zeros for an empty cart', () => {
    expect(cartTotals()).toEqual({
      subtotalCents: 0,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });
});
