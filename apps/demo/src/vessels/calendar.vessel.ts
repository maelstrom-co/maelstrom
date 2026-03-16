import type { Vessel } from '@maelstrom-co/protocol';
import { vesselRegistration } from '@maelstrom-co/react';
import { CalendarSkeleton } from './calendar.skeleton';

// Calendar vessel definition - always eagerly loaded for LLM decisions
export const calendarVessel: Vessel = {
  id: 'calendar',
  name: 'Calendar',
  description:
    'Calendar widget for viewing dates and scheduling. Can show month view, week view, or be collapsed to a minimal state.',
  defaultVariant: 'month',
  variants: {
    month: {
      props: { view: 'month' },
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showWeek',
          description: 'Switch to week view for more detail',
          transitionsTo: 'week',
        },
        {
          name: 'collapse',
          description: 'Minimize the calendar to save space',
          transitionsTo: 'collapsed',
        },
      ],
    },
    week: {
      props: { view: 'week' },
      minSize: { width: 6, height: 3 },
      actions: [
        {
          name: 'showMonth',
          description: 'Switch back to month view',
          transitionsTo: 'month',
        },
        {
          name: 'collapse',
          description: 'Minimize the calendar',
          transitionsTo: 'collapsed',
        },
      ],
    },
    collapsed: {
      props: { collapsed: true },
      minSize: { width: 2, height: 1 },
      actions: [
        {
          name: 'expand',
          description: 'Expand the calendar to full view',
          transitionsTo: 'month',
        },
      ],
    },
  },
};

// Lazy registration - component is loaded on first render
// Uses vesselRegistration helper which requires a loading component for lazy loading
export const calendarRegistration = vesselRegistration(
  calendarVessel,
  () => import('./calendar.component'),
  CalendarSkeleton,
);
