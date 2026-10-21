import { vessel } from '@maelstrom-co/react';
import { VacationReplySkeleton } from './vacation-reply.skeleton';
import { vacationReplyVessel } from './vacation-reply.vessel.def';

export { vacationReplyVessel };

export const vacationReplyEntry = vessel(
  vacationReplyVessel,
  () => import('./vacation-reply.component'),
  VacationReplySkeleton,
);
