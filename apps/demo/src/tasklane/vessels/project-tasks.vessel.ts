import { vessel } from '@maelstrom-co/react';
import { ProjectTasksSkeleton } from './project-tasks.skeleton';
import { projectTasksVessel } from './project-tasks.vessel.def';

export { projectTasksVessel };

export const projectTasksEntry = vessel(
  projectTasksVessel,
  () => import('./project-tasks.component'),
  ProjectTasksSkeleton,
);
