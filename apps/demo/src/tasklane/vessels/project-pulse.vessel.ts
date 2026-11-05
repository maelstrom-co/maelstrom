import { vessel } from '@maelstrom-co/react';
import { ProjectPulseSkeleton } from './project-pulse.skeleton';
import { projectPulseVessel } from './project-pulse.vessel.def';

export { projectPulseVessel };

export const projectPulseEntry = vessel(
  projectPulseVessel,
  () => import('./project-pulse.component'),
  ProjectPulseSkeleton,
);
