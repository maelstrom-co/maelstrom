import { defineVessel } from '@maelstrom-co/protocol';

const SHOW_ORDER_DETAILS = {
  name: 'showOrderDetails',
  idempotent: true,
  description:
    'Open one past order to see its line items (SKU, product name, quantity, unit price) and totals. Use this to find out exactly which products the customer bought before, e.g. the SKU of the dog food they usually reorder.',
  parameters: [
    {
      name: 'orderId',
      type: 'string',
      description: 'Order id like ORD-10455, as listed in the orders list.',
    },
  ],
} as const;

const SHOW_MOST_RECENT_ORDER = {
  name: 'showMostRecentOrder',
  idempotent: true,
  description:
    'Open the customer\'s most recent order to see its line items. The quickest way to answer "what did I order last time" or to start a reorder.',
} as const;

export const ordersVessel = defineVessel({
  id: 'orders',
  name: 'Orders',
  description:
    "Past pet-food orders for the signed-in customer, Sam Rivera, who has a dog (Biscuit, adult Labrador) and a cat (Miso, indoor adult). List view shows every order newest first with date, items and total; detail view shows one order's line items with SKU, name, quantity and price. Use this to review purchase history before reordering. New orders placed through the checkout vessel appear here automatically.",
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        { ...SHOW_ORDER_DETAILS, transitionsTo: 'detail' },
        { ...SHOW_MOST_RECENT_ORDER, transitionsTo: 'detail' },
      ],
    },
    detail: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        SHOW_ORDER_DETAILS,
        SHOW_MOST_RECENT_ORDER,
        {
          name: 'backToOrderList',
          idempotent: true,
          description: 'Return to the list of all past orders',
          transitionsTo: 'list',
        },
      ],
    },
  },
});
