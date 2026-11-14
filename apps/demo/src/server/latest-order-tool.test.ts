import type { ServerToolContext } from '@maelstrom-co/engine';
import { describe, expect, it } from 'vitest';

import type { Order } from '../shop/stores/fixtures';
import { latestOrderTool, newestOrder } from './latest-order-tool';

const EXPECTED_SUMMARY =
  'Order ORD-10455 placed 2026-09-14: 1x Summit Trail Adult Chicken & Brown Rice, 1x Whisker & Co Indoor Adult Chicken';

describe('newestOrder', () => {
  it('picks the newest order even when it is not first in the list', () => {
    const orders = [
      orderOn('ORD-2', '2026-03-01'),
      orderOn('ORD-3', '2026-09-14'),
      orderOn('ORD-1', '2026-01-20'),
    ];

    expect(newestOrder(orders)?.id).toBe('ORD-3');
  });

  it('returns undefined for an empty list', () => {
    expect(newestOrder([])).toBeUndefined();
  });
});

describe('latestOrderTool', () => {
  it('returns the newest seed order and its output passes the output schema', async () => {
    const output = await latestOrderTool.execute({}, contextFor());

    expect(output.orderId).toBe('ORD-10455');
    expect(output.placedOn).toBe('2026-09-14');
    expect(latestOrderTool.output.safeParse(output).success).toBe(true);
  });

  it('declares the order id, date and SKUs as intent facts', async () => {
    const output = await latestOrderTool.execute({}, contextFor());

    expect(latestOrderTool.intentFacts?.(output)).toEqual({
      orderId: 'ORD-10455',
      placedOn: '2026-09-14',
      skus: output.items.map((item) => item.sku),
    });
    expect(latestOrderTool.intentFacts?.(output)).toMatchObject({
      skus: ['DOG-DRY-SUMMIT-ADULT-30', 'CAT-DRY-WHISKER-INDOOR-16'],
    });
  });

  it('summarizes the order id, items and date in one line of at most 200 characters', async () => {
    const output = await latestOrderTool.execute({}, contextFor());

    const summary = latestOrderTool.summarize(output);

    expect(summary).toBe(EXPECTED_SUMMARY);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).not.toMatch(/\n/);
  });

  it('describes the tool as reading the seed order history', () => {
    expect(latestOrderTool.description).toBe(
      "Returns the shopper's most recent order from the pet shop seed order history, with its date, line items and totals.",
    );
  });

  it('keeps the caller token and user out of the output and summary', async () => {
    const tokenSentinel = 'sentinel-token-7f3a9c';
    const userSentinel = 'sentinel-user-b41e02';

    const output = await latestOrderTool.execute(
      {},
      contextFor({
        token: tokenSentinel,
        user: { id: userSentinel, name: userSentinel },
      }),
    );
    const serializedOutput = JSON.stringify(output);
    const summary = latestOrderTool.summarize(output);

    for (const sentinel of [tokenSentinel, userSentinel]) {
      expect(serializedOutput).not.toContain(sentinel);
      expect(summary).not.toContain(sentinel);
    }
  });
});

function contextFor(
  overrides: Partial<Pick<ServerToolContext, 'token' | 'user'>> = {},
): ServerToolContext {
  return {
    user: undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function orderOn(id: string, placedOn: string): Order {
  return {
    id,
    placedOn,
    items: [],
    totals: { subtotalCents: 0, shippingCents: 0, taxCents: 0, totalCents: 0 },
  } as unknown as Order;
}
