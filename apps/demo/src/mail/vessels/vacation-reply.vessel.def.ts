import { defineVessel } from '@maelstrom-co/protocol';

export const vacationReplyVessel = defineVessel({
  id: 'vacation-reply',
  name: 'Vacation reply',
  description:
    'Setting. An automatic reply sent while you are away. Use when someone is going on holiday, out of office, or away for a while. Show it whenever someone wants to set up, check or turn off an away reply, even before they give the wording, so they can set it on screen.',
  defaultVariant: 'panel',
  variants: {
    panel: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'setVacationReply',
          idempotent: true,
          description: 'Turn the automatic away reply on or off',
          parameters: [
            {
              name: 'on',
              type: 'boolean',
              description: 'True to send the away reply, false to stop it',
            },
            {
              name: 'message',
              type: 'string',
              required: false,
              description:
                'The away message to send. Leave out to keep the current one.',
            },
          ],
        },
      ],
    },
  },
});
