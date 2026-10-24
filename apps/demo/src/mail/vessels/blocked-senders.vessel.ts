import { vessel } from '@maelstrom-co/react';
import { BlockedSendersSkeleton } from './blocked-senders.skeleton';
import { blockedSendersVessel } from './blocked-senders.vessel.def';

export { blockedSendersVessel };

export const blockedSendersEntry = vessel(
  blockedSendersVessel,
  () => import('./blocked-senders.component'),
  BlockedSendersSkeleton,
);
