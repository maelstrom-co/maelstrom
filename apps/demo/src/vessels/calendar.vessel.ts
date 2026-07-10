import { defineVessel } from '@maelstrom-co/protocol';
import { vessel } from '@maelstrom-co/react';
import { CalendarSkeleton } from './calendar.skeleton';

export const calendarVessel = defineVessel({
  id: 'calendar',
  name: 'Calendar',
  description:
    "Calendar widget for viewing dates and scheduling. Supports month view, week view, and day view with hourly time blocks. Today's day view includes a 10:00 AM \"Design review — Studio Vortex HQ\". When the user asks about getting somewhere or being there by a time, pair with the map vessel's showRoute action, passing the event's location (e.g. \"Studio Vortex HQ\") as the destination.",
  defaultVariant: 'month',
  variants: {
    month: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showWeek',
          description: 'Switch to week view for event timeline',
          transitionsTo: 'week',
        },
        {
          name: 'showDay',
          description: 'Switch to day view for hourly schedule',
          transitionsTo: 'day',
        },
      ],
    },
    week: {
      props: {},
      minSize: { width: 6, height: 3 },
      actions: [
        {
          name: 'showMonth',
          description: 'Switch back to month view',
          transitionsTo: 'month',
        },
        {
          name: 'showDay',
          description: 'Switch to day view',
          transitionsTo: 'day',
        },
      ],
    },
    day: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showMonth',
          description: 'Switch to month view',
          transitionsTo: 'month',
        },
        {
          name: 'showWeek',
          description: 'Switch to week view',
          transitionsTo: 'week',
        },
      ],
    },
  },
});

export const calendarEntry = vessel(
  calendarVessel,
  () => import('./calendar.component'),
  CalendarSkeleton,
);
