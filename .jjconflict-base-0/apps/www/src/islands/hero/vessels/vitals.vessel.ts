import { defineVessel } from '@maelstrom-co/protocol';

export const vitalsVessel = defineVessel({
  id: 'vitals',
  name: 'Vitals Tracker',
  description:
    'Patient vitals (heart rate, oxygen). Wide view spreads the metrics across the row.',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'widen',
          description: 'Spread the metrics across the row',
          transitionsTo: 'wide',
        },
      ],
    },
    wide: {
      props: {},
      minSize: { width: 6, height: 2 },
      actions: [
        {
          name: 'narrow',
          description: 'Return to the compact view',
          transitionsTo: 'default',
        },
      ],
    },
  },
});
