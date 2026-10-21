import { defineVessel } from '@maelstrom-co/protocol';

export const inboxVessel = defineVessel({
  id: 'inbox',
  name: 'Inbox',
  description:
    'The list of received emails. Part of the main mail view and shown by default. Not a setting.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 3, height: 4 },
      actions: [
        {
          name: 'openEmail',
          idempotent: true,
          description:
            'Open an email from the inbox so it shows in the message view',
          parameters: [
            {
              name: 'subject',
              type: 'string',
              description:
                'Subject of the email to open. Must be one of the subjects listed in the inbox.',
            },
          ],
        },
      ],
    },
  },
});
