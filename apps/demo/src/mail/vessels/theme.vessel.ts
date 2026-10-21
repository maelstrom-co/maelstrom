import { vessel } from '@maelstrom-co/react';
import { ThemeSkeleton } from './theme.skeleton';
import { themeVessel } from './theme.vessel.def';

export { themeVessel };

export const themeEntry = vessel(
  themeVessel,
  () => import('./theme.component'),
  ThemeSkeleton,
);
