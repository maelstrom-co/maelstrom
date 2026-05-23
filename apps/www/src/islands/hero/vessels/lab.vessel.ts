import { defineVessel } from '@maelstrom-co/protocol';

export const labVessel = defineVessel({
  id: 'lab',
  name: 'Lab Results',
  description:
    'Trial lab results with a trend sparkline. Full view shows the trend/value readout; mini shows just the sparkline.',
  defaultVariant: 'full',
  variants: {
    full: {
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [
        {
          name: 'minimize',
          description: 'Collapse to the compact sparkline',
          transitionsTo: 'mini',
        },
      ],
    },
    mini: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'expand',
          description: 'Expand to the full results view',
          transitionsTo: 'full',
        },
      ],
    },
  },
});
