import { vessel } from '@maelstrom-co/react';

import { MyPrioritiesSkeleton } from './my-priorities.skeleton';
import { myPrioritiesVessel } from './my-priorities.vessel.def';

export { myPrioritiesVessel };

export const myPrioritiesEntry = vessel(
  myPrioritiesVessel,
  () => import('./my-priorities.component'),
  MyPrioritiesSkeleton,
);
