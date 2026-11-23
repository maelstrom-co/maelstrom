import { createMaelstrom, vessel } from '@maelstrom-co/react';

import { ordersVessel } from './orders.vessel';
import { OrdersVessel } from './OrdersVessel';

export const m = createMaelstrom({
  vessels: [vessel(ordersVessel, OrdersVessel)],
});
