import { vessel } from '@maelstrom-co/react';
import { PrivacySkeleton } from './privacy.skeleton';
import { privacyVessel } from './privacy.vessel.def';

export { privacyVessel };

export const privacyEntry = vessel(
  privacyVessel,
  () => import('./privacy.component'),
  PrivacySkeleton,
);
