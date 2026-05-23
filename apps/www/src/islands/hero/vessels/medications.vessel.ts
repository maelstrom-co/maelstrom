import { defineVessel } from '@maelstrom-co/protocol';

export const medicationsVessel = defineVessel({
  id: 'medications',
  name: 'Medications',
  description:
    'Current medications with dose and schedule. Wide view lays them out across columns.',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'widen',
          description: 'Lay medications out across columns',
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
          description: 'Return to the stacked list',
          transitionsTo: 'default',
        },
      ],
    },
  },
});
