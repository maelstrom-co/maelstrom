import { defineVessel } from '@maelstrom-co/protocol';

export const appointmentsVessel = defineVessel({
  id: 'appointments',
  name: 'Appointments',
  description:
    'Upcoming appointments with provider and time. Big view shows more of the schedule.',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'enlarge',
          description: 'Show more upcoming appointments',
          transitionsTo: 'big',
        },
      ],
    },
    big: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'shrink',
          description: 'Show only the next appointments',
          transitionsTo: 'default',
        },
      ],
    },
  },
});
