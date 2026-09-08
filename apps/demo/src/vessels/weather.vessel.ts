import { vessel } from '@maelstrom-co/react';
import { WeatherSkeleton } from './weather.skeleton';
import { weatherVessel } from './weather.vessel.def';

export { weatherVessel };

export const weatherEntry = vessel(
  weatherVessel,
  () => import('./weather.component'),
  WeatherSkeleton,
);
