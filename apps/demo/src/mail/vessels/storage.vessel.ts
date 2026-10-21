import { vessel } from '@maelstrom-co/react';
import { StorageSkeleton } from './storage.skeleton';
import { storageVessel } from './storage.vessel.def';

export { storageVessel };

export const storageEntry = vessel(
  storageVessel,
  () => import('./storage.component'),
  StorageSkeleton,
);
