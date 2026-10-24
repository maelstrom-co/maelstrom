import { vessel } from '@maelstrom-co/react';
import { MessageSkeleton } from './message.skeleton';
import { messageVessel } from './message.vessel.def';

export { messageVessel };

export const messageEntry = vessel(
  messageVessel,
  () => import('./message.component'),
  MessageSkeleton,
);
