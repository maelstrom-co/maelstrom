import { vessel } from '@maelstrom-co/react';

import { FlexibleTableSkeleton } from './flexible-table.skeleton';
import { flexibleTableVessel } from './flexible-table.vessel.def';

export { flexibleTableVessel };

export const flexibleTableEntry = vessel(
  flexibleTableVessel,
  () => import('./flexible-table.component'),
  FlexibleTableSkeleton,
);
