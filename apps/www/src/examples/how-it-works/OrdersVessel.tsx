import { OrdersPanel, loadOrder } from './app';
import { m } from './maelstrom';

export function OrdersVessel({ instanceId }: { instanceId: string }) {
  m.useActions('orders', instanceId, {
    selectOrder: async ({ orderId }) => loadOrder(orderId),
  });

  return <OrdersPanel />;
}
