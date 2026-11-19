import { createMaelstrom, vessel } from '@maelstrom-co/react';

import { ordersVessel } from './orders.vessel';
import { OrdersPanel } from './OrdersPanel';

export const m = createMaelstrom({
  vessels: [vessel(ordersVessel, OrdersPanel)],
});
