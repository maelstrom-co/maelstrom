import { vessel } from '@maelstrom-co/react';

import { TriageInboxSkeleton } from './triage-inbox.skeleton';
import { triageInboxVessel } from './triage-inbox.vessel.def';

export { triageInboxVessel };

export const triageInboxEntry = vessel(
  triageInboxVessel,
  () => import('./triage-inbox.component'),
  TriageInboxSkeleton,
);
