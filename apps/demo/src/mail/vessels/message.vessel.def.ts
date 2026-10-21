import { defineVessel } from '@maelstrom-co/protocol';

export const messageVessel = defineVessel({
  id: 'message',
  name: 'Message',
  description:
    'The email that is open right now. Part of the main mail view. Keep it visible when settings change so the effect can be seen. Not a setting.',
  defaultVariant: 'read',
  variants: {
    read: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'reply',
          description: 'Start a reply to the open email',
        },
      ],
    },
  },
});
