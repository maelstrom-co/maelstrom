import { vessel } from '@maelstrom-co/react';
import { JournalSkeleton } from './journal.skeleton';
import { journalVessel } from './journal.vessel.def';

export { journalVessel };

export const journalEntry = vessel(
  journalVessel,
  () => import('./journal.component'),
  JournalSkeleton,
);
