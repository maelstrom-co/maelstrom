import { ok } from '@maelstrom-co/protocol';

import { OrdersPanel, loadOrder } from './app';
import { m } from './maelstrom';

export function OrdersVessel({ instanceId }: { instanceId: string }) {
  m.useActions('orders', instanceId, {
    selectOrder: async ({ orderId }) => {
      await loadOrder(orderId);
      return ok(undefined);
    },
  });

  return <OrdersPanel />;
}
