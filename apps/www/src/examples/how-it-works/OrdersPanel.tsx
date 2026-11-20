import { ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useState } from 'react';

import { m } from './maelstrom';
import type { ordersVessel } from './orders.vessel';

export function OrdersPanel({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof ordersVessel>) {
  const [openOrderId, setOpenOrderId] = useState<string>();

  m.useActions('orders', instanceId, {
    selectOrder: async ({ orderId }) => {
      setOpenOrderId(orderId);
      return ok(undefined);
    },
  });

  return variantProps.variant === 'list' ? (
    <p>All orders</p>
  ) : (
    <p>Order {openOrderId}</p>
  );
}
