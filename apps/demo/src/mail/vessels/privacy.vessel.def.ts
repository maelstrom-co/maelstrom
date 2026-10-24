import { defineVessel } from '@maelstrom-co/protocol';

export const privacyVessel = defineVessel({
  id: 'privacy',
  name: 'Privacy',
  description:
    'Setting. Control read receipts and whether pictures in emails load on their own. Use when someone asks about privacy, tracking, or who knows they read an email. Show it whenever someone wants to see, check or adjust privacy settings, even before they say which one, so they can choose on screen.',
  defaultVariant: 'panel',
  variants: {
    panel: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'setReadReceipts',
          idempotent: true,
          description: 'Turn read receipts on or off',
          parameters: [
            {
              name: 'on',
              type: 'boolean',
              description: 'True to let senders know you read their email',
            },
          ],
        },
        {
          name: 'setRemoteImages',
          idempotent: true,
          description: 'Turn automatic loading of pictures in emails on or off',
          parameters: [
            {
              name: 'on',
              type: 'boolean',
              description: 'True to load pictures on their own',
            },
          ],
        },
      ],
    },
  },
});
