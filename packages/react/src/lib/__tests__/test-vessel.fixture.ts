import { defineVessel } from '@maelstrom-co/protocol-old';

export const testVessel = defineVessel({
  id: 'orders',
  name: 'Orders',
  description: 'Order management vessel',
  defaultVariant: 'list',
  variants: {
    list: {
      props: { view: 'list', pageSize: 10 },
      minSize: { width: 2, height: 2 },
      actions: [
        {
          name: 'selectOrder',
          description: 'Select an order',
          parameters: [
            { name: 'orderId', type: 'string', description: 'Order ID', required: true },
          ],
        },
        {
          name: 'refresh',
          description: 'Refresh list',
        },
      ],
    },
    detail: {
      props: { view: 'detail', orderId: '' },
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'close',
          description: 'Close detail',
        },
      ],
    },
  },
});

export type TestVessel = typeof testVessel;
