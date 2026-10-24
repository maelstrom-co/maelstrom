import { defineVessel } from '@maelstrom-co/protocol';

export const messageVessel = defineVessel({
  id: 'message',
  name: 'Message',
  description:
    'One open email, shown in full. Part of the main mail view. Each Message instance shows a single email chosen with showEmail, so several emails can be open side by side in separate instances. Emails can be found by sender or subject. Keep the open email visible when settings change so the effect can be seen. Not a setting.',
  defaultVariant: 'read',
  variants: {
    read: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showEmail',
          idempotent: true,
          description:
            'Show an email in this Message instance. Find it by sender, subject or both.',
          parameters: [
            {
              name: 'email',
              type: 'string',
              description:
                'The email to show, written as "Sender: Subject". Pick the allowed value whose sender or subject matches what the user said, for example the sender name for "the email from Tom" or the subject for "the library notice".',
            },
          ],
        },
        {
          name: 'reply',
          description: 'Start a reply to the email shown in this instance',
        },
      ],
    },
  },
});
