import { vessel } from '@maelstrom-co/react';
import { OrdersSkeleton } from './orders.skeleton';
import { ordersVessel } from './orders.vessel.def';

export { ordersVessel };

export const ordersEntry = vessel(
  ordersVessel,
  () => import('./orders.component'),
  OrdersSkeleton,
);
