import { vessel } from '@maelstrom-co/react';
import { CatalogSkeleton } from './catalog.skeleton';
import { catalogVessel } from './catalog.vessel.def';

export { catalogVessel };

export const catalogEntry = vessel(
  catalogVessel,
  () => import('./catalog.component'),
  CatalogSkeleton,
);
