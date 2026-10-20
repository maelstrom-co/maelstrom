import { describe, expect, it } from 'vitest';
import { calculateOrderTotals, SEED_ORDERS } from './pet-shop-fixtures';

describe('calculateOrderTotals', () => {
  it('charges flat shipping one cent below the free-shipping threshold', () => {
    expect(
      calculateOrderTotals([
        { quantity: 2, unitPriceCents: 2000 },
        { quantity: 1, unitPriceCents: 899 },
      ]),
    ).toEqual({
      subtotalCents: 4899,
      shippingCents: 599,
      taxCents: 392,
      totalCents: 5890,
    });
  });

  it('ships free at exactly the threshold', () => {
    expect(
      calculateOrderTotals([{ quantity: 1, unitPriceCents: 4900 }]),
    ).toEqual({
      subtotalCents: 4900,
      shippingCents: 0,
      taxCents: 392,
      totalCents: 5292,
    });
  });

  it('is all zeros for no items', () => {
    expect(calculateOrderTotals([])).toEqual({
      subtotalCents: 0,
      shippingCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });
});

describe('SEED_ORDERS', () => {
  it.each(
    SEED_ORDERS.map((order) => [order.id, order] as const),
  )('%s carries the totals of its items', (_id, order) => {
    expect(order.totals).toEqual(calculateOrderTotals(order.items));
  });
});
