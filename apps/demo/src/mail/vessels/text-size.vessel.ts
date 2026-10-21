import { vessel } from '@maelstrom-co/react';
import { TextSizeSkeleton } from './text-size.skeleton';
import { textSizeVessel } from './text-size.vessel.def';

export { textSizeVessel };

export const textSizeEntry = vessel(
  textSizeVessel,
  () => import('./text-size.component'),
  TextSizeSkeleton,
);
