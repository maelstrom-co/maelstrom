import { defineVessel } from '@maelstrom-co/protocol-old';

export const calendarVessel = defineVessel({
  id: 'calendar',
  name: 'Calendar',
  description: 'Calendar showing events. Supports month and week views.',
  defaultVariant: 'month',
  variants: {
    month: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        { name: 'showWeek', description: 'Switch to week view', transitionsTo: 'week' },
      ],
    },
    week: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        { name: 'showMonth', description: 'Switch to month view', transitionsTo: 'month' },
      ],
    },
  },
});
