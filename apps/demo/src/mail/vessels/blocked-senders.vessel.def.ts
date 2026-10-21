import { defineVessel } from '@maelstrom-co/protocol';

export const blockedSendersVessel = defineVessel({
  id: 'blocked-senders',
  name: 'Blocked senders',
  description:
    'Setting. The people and addresses you never want email from. Use when someone wants to block or unblock a sender, or stop spam from someone.',
  defaultVariant: 'panel',
  variants: {
    panel: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'blockSender',
          description: 'Block an email address',
          parameters: [
            {
              name: 'email',
              type: 'string',
              description: 'The email address to block',
            },
          ],
        },
        {
          name: 'unblockSender',
          description: 'Unblock an email address that is on the blocked list',
          parameters: [
            {
              name: 'email',
              type: 'string',
              description: 'The blocked email address to unblock',
            },
          ],
        },
      ],
    },
  },
});
