import { vessel } from '@maelstrom-co/react';
import { CheckoutSkeleton } from './checkout.skeleton';
import { checkoutVessel } from './checkout.vessel.def';

export { checkoutVessel };

export const checkoutEntry = vessel(
  checkoutVessel,
  () => import('./checkout.component'),
  CheckoutSkeleton,
);
