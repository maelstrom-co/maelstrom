import { ok } from '@maelstrom-co/protocol';
import { useState } from 'react';

import { m } from './maelstrom';

export function OrdersPanel({ instanceId }: { instanceId: string }) {
  const [orderId, setOrderId] = useState<string>();

  m.useActions('orders', instanceId, {
    selectOrder: async ({ orderId }) => {
      setOrderId(orderId);
      return ok(undefined);
    },
  });

  return <p>{orderId ? `Order ${orderId}` : 'All orders'}</p>;
}
