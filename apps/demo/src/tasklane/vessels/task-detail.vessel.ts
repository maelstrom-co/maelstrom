import { vessel } from '@maelstrom-co/react';

import { TaskDetailSkeleton } from './task-detail.skeleton';
import { taskDetailVessel } from './task-detail.vessel.def';

export { taskDetailVessel };

export const taskDetailEntry = vessel(
  taskDetailVessel,
  () => import('./task-detail.component'),
  TaskDetailSkeleton,
);
