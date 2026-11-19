import { defineVessel } from '@maelstrom-co/protocol';

export const ordersVessel = defineVessel({
  id: 'orders',
  name: 'Orders Panel',
  description: 'Lists orders and shows the details of one order',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [
        {
          name: 'selectOrder',
          description: 'Open the details of one order',
          parameters: [
            {
              name: 'orderId',
              type: 'string',
              description: 'Order to open',
              required: true,
            },
          ],
          transitionsTo: 'details',
        },
      ],
    },
    details: { props: {}, minSize: { width: 6, height: 5 }, actions: [] },
  },
});
