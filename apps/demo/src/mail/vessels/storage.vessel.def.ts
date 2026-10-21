import { defineVessel } from '@maelstrom-co/protocol';

export const storageVessel = defineVessel({
  id: 'storage',
  name: 'Storage',
  description:
    'Setting. How much space your email uses and how much is left. Use when someone asks if their mailbox is full or how much room they have. Show it whenever someone asks about space, storage or how full their mailbox is, so they can see it on screen.',
  defaultVariant: 'panel',
  variants: {
    panel: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [],
    },
  },
});
