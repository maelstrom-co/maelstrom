import { defineVessel } from '@maelstrom-co/protocol';

export const labVessel = defineVessel({
  id: 'lab',
  name: 'Lab Results',
  description: 'Trial lab results with a trend sparkline and value readout.',
  defaultVariant: 'full',
  variants: {
    full: {
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [],
    },
  },
});
