import { defineVessel } from '@maelstrom-co/protocol';

export const medicationsVessel = defineVessel({
  id: 'medications',
  name: 'Medications',
  description: 'Current medications with dose and schedule.',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [],
    },
  },
});
