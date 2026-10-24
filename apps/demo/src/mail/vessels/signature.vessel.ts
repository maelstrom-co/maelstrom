import { vessel } from '@maelstrom-co/react';
import { SignatureSkeleton } from './signature.skeleton';
import { signatureVessel } from './signature.vessel.def';

export { signatureVessel };

export const signatureEntry = vessel(
  signatureVessel,
  () => import('./signature.component'),
  SignatureSkeleton,
);
