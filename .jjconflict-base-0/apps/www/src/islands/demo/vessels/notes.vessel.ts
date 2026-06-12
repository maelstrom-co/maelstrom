import { defineVessel } from '@maelstrom-co/protocol';

export const notesVessel = defineVessel({
  id: 'notes',
  name: 'Notes',
  description: 'Quick notes widget.',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 2, height: 2 },
      actions: [],
    },
  },
});
