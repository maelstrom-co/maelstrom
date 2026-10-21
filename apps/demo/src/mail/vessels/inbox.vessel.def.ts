import { defineVessel } from '@maelstrom-co/protocol';

export const inboxVessel = defineVessel({
  id: 'inbox',
  name: 'Inbox',
  description:
    'The list of received emails, each showing its sender and subject. Part of the main mail view and shown by default. Not a setting. It only lists emails. An email is opened in a Message, and emails can be found by sender or subject.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 3, height: 4 },
      actions: [],
    },
  },
});
