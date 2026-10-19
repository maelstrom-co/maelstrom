import { vessel } from '@maelstrom-co/react';
import { LabsSkeleton } from './labs.skeleton';
import { labsVessel } from './labs.vessel.def';

export { labsVessel };

export const labsEntry = vessel(
  labsVessel,
  () => import('./labs.component'),
  LabsSkeleton,
);
