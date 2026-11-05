import { vessel } from '@maelstrom-co/react';
import { TeamLoadSkeleton } from './team-load.skeleton';
import { teamLoadVessel } from './team-load.vessel.def';

export { teamLoadVessel };

export const teamLoadEntry = vessel(
  teamLoadVessel,
  () => import('./team-load.component'),
  TeamLoadSkeleton,
);
