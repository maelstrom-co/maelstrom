import { vessel } from '@maelstrom-co/react';
import { InboxSkeleton } from './inbox.skeleton';
import { inboxVessel } from './inbox.vessel.def';

export { inboxVessel };

export const inboxEntry = vessel(
  inboxVessel,
  () => import('./inbox.component'),
  InboxSkeleton,
);
