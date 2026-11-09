import { serverTool, ToolError } from '@maelstrom-co/engine';
import { z } from 'zod';

import { CUSTOMER, type Order, SEED_ORDERS } from '../shop/stores/fixtures';

const SUMMARY_MAX_LENGTH = 200;

const latestOrderLineItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
});

const latestOrderTotalsSchema = z.object({
  subtotalCents: z.number().int().nonnegative(),
  shippingCents: z.number().int().nonnegative(),
  taxCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
});

const latestOrderOutputSchema = z.object({
  orderId: z.string(),
  placedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerName: z.string(),
  items: z.array(latestOrderLineItemSchema).min(1),
  totals: latestOrderTotalsSchema,
});

export const latestOrderTool = serverTool({
  name: 'latest_order',
  description:
    "Returns the shopper's most recent pet shop order with its date, line items and totals.",
  input: z.object({}),
  output: latestOrderOutputSchema,
  sideEffect: 'read_only',
  execute: async () => {
    const order = newestOrder(SEED_ORDERS);
    if (!order) throw new ToolError('No orders found for this shopper');
    return {
      orderId: order.id,
      placedOn: order.placedOn,
      customerName: CUSTOMER.name,
      items: order.items.map((item) => ({ ...item })),
      totals: { ...order.totals },
    };
  },
  summarize: (order) =>
    truncateToSummaryLength(
      `Order ${order.orderId} placed ${order.placedOn}: ${order.items
        .map((item) => `${item.quantity}x ${item.name}`)
        .join(', ')}`,
    ),
});

function newestOrder(orders: readonly Order[]): Order | undefined {
  return orders.reduce<Order | undefined>(
    (newest, order) =>
      !newest || order.placedOn > newest.placedOn ? order : newest,
    undefined,
  );
}

function truncateToSummaryLength(summary: string): string {
  const oneLine = summary.replace(/\s+/g, ' ').trim();
  return oneLine.length <= SUMMARY_MAX_LENGTH
    ? oneLine
    : `${oneLine.slice(0, SUMMARY_MAX_LENGTH - 3)}...`;
}
