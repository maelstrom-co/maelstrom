import { vessel } from '@maelstrom-co/react';
import { TasksSkeleton } from './tasks.skeleton';
import { tasksVessel } from './tasks.vessel.def';

export { tasksVessel };

export const tasksEntry = vessel(
  tasksVessel,
  () => import('./tasks.component'),
  TasksSkeleton,
);
