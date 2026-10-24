import { beforeEach, describe, expect, it } from 'vitest';
import type { Order } from './fixtures';
import {
  __resetOrdersStoreForTests,
  findOrder,
  getOrdersSnapshot,
  ordersActions,
} from './orders.store';

beforeEach(() => {
  __resetOrdersStoreForTests();
});

describe('seeded orders', () => {
  it('lists the seed orders newest first with nothing selected', () => {
    const { orders, selectedOrderId } = getOrdersSnapshot();
    expect(orders.map((order) => order.id)).toEqual([
      'ORD-10455',
      'ORD-10421',
      'ORD-10388',
      'ORD-10307',
    ]);
    expect(selectedOrderId).toBeNull();
  });
});

describe('findOrder', () => {
  it('accepts an order id with or without the ORD- prefix, in any case', () => {
    expect(findOrder('ORD-10421')?.id).toBe('ORD-10421');
    expect(findOrder('ord-10421')?.id).toBe('ORD-10421');
    expect(findOrder(' 10421 ')?.id).toBe('ORD-10421');
  });

  it('returns undefined for an id that is not on record', () => {
    expect(findOrder('ORD-1')).toBeUndefined();
    expect(findOrder('')).toBeUndefined();
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

  it('selects an order by id and leaves the selection alone for an unknown id', () => {
    expect(ordersActions.showOrderDetails('10388')?.id).toBe('ORD-10388');
    expect(getOrdersSnapshot().selectedOrderId).toBe('ORD-10388');

    const before = getOrdersSnapshot();
    expect(ordersActions.showOrderDetails('ORD-1')).toBeNull();
    expect(getOrdersSnapshot()).toBe(before);
  });

  it('clears the selection on backToOrderList', () => {
    ordersActions.showOrderDetails('ord-10307');
    ordersActions.backToOrderList();
    expect(getOrdersSnapshot().selectedOrderId).toBeNull();
  });

  it('records a new order at the top of the list', () => {
    const order: Order = {
      id: ordersActions.nextOrderId(),
      placedOn: '2026-10-08',
      status: 'processing',
      items: [],
      totals: {
        subtotalCents: 0,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 0,
      },
    };
    ordersActions.recordOrder(order);

    expect(order.id).toBe('ORD-10456');
    expect(getOrdersSnapshot().orders[0]).toBe(order);
    expect(getOrdersSnapshot().orders).toHaveLength(5);
    expect(ordersActions.nextOrderId()).toBe('ORD-10457');
  });
});
