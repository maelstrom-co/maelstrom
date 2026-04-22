import { defineVessel } from '@maelstrom-co/protocol';

export const weatherVessel = defineVessel({
  id: 'weather',
  name: 'Weather',
  description: 'Weather widget showing current conditions and forecast.',
  defaultVariant: 'compact',
  variants: {
    compact: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        { name: 'expand', description: 'Show full weather forecast', transitionsTo: 'full' },
      ],
    },
    full: {
      props: {},
      minSize: { width: 3, height: 4 },
      actions: [
        { name: 'collapse', description: 'Show compact weather', transitionsTo: 'compact' },
      ],
    },
  },
});
