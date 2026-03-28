import type { Vessel } from '@maelstrom-co/protocol-old';

export const notesVessel: Vessel = {
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
};
