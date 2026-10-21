import { vessel } from '@maelstrom-co/react';
import { CartSkeleton } from './cart.skeleton';
import { cartVessel } from './cart.vessel.def';

export { cartVessel };

export const cartEntry = vessel(
  cartVessel,
  () => import('./cart.component'),
  CartSkeleton,
);
