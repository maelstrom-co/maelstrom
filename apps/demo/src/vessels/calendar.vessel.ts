import { defineVessel } from '@maelstrom-co/protocol';
import { vessel } from '@maelstrom-co/react';
import { CalendarSkeleton } from './calendar.skeleton';

// Shared across every variant — addEvent/removeEvent/moveEvent behave
// identically regardless of which view is currently showing.
const EVENT_ACTIONS = [
  {
    name: 'addEvent',
    description: "Add an event to today's schedule",
    parameters: [
      { name: 'title', type: 'string', description: 'Event title' },
      {
        name: 'time',
        type: 'string',
        description: 'Time like 9:00 or 14:30',
      },
    ],
  },
  {
    name: 'removeEvent',
    description: "Remove an event from today's schedule by title",
    parameters: [
      {
        name: 'title',
        type: 'string',
        description: 'Title of the event to remove',
      },
    ],
  },
  {
    name: 'moveEvent',
    description: "Reschedule an event on today's schedule to a new time",
    parameters: [
      {
        name: 'title',
        type: 'string',
        description: 'Title of the event to move',
      },
      {
        name: 'time',
        type: 'string',
        description: 'New time like 9:00 or 14:30',
      },
    ],
  },
] as const;

export const calendarVessel = defineVessel({
  id: 'calendar',
  name: 'Calendar',
  description:
    "Calendar widget for viewing dates and scheduling. Supports month view, week view, and day view with hourly time blocks. Every view also supports addEvent, removeEvent, and moveEvent for today's schedule — use these whenever the user adds, cancels, or reschedules something for today. Today's day view starts with a 7:30 AM \"Gym\" and a 10:00 AM \"Design review — Studio Vortex HQ\". When the user asks about getting somewhere or being there by a time, pair with the map vessel's showRoute action, passing the event's location (e.g. \"Studio Vortex HQ\") as the destination.",
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
        ...EVENT_ACTIONS.map((action) => ({
          ...action,
          transitionsTo: 'day' as const,
        })),
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
        ...EVENT_ACTIONS,
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
        ...EVENT_ACTIONS,
      ],
    },
  },
});

export const calendarEntry = vessel(
  calendarVessel,
  () => import('./calendar.component'),
  CalendarSkeleton,
);
