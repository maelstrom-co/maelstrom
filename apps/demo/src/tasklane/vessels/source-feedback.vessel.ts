import { vessel } from '@maelstrom-co/react';
import { SourceFeedbackSkeleton } from './source-feedback.skeleton';
import { sourceFeedbackVessel } from './source-feedback.vessel.def';

export { sourceFeedbackVessel };

export const sourceFeedbackEntry = vessel(
  sourceFeedbackVessel,
  () => import('./source-feedback.component'),
  SourceFeedbackSkeleton,
);
