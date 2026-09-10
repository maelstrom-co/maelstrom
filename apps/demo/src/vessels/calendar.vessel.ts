import { vessel } from '@maelstrom-co/react';
import { CalendarSkeleton } from './calendar.skeleton';
import { calendarVessel } from './calendar.vessel.def';

export { calendarVessel };

export const calendarEntry = vessel(
  calendarVessel,
  () => import('./calendar.component'),
  CalendarSkeleton,
);
