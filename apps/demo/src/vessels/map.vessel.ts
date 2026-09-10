import { vessel } from '@maelstrom-co/react';
import { MapSkeleton } from './map.skeleton';
import { mapVessel } from './map.vessel.def';

export { mapVessel };

export const mapEntry = vessel(
  mapVessel,
  () => import('./map.component'),
  MapSkeleton,
);
