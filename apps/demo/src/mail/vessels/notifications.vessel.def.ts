import { defineVessel } from '@maelstrom-co/protocol';

export const notificationsVessel = defineVessel({
  id: 'notifications',
  name: 'Notifications',
  description:
    'Setting. Turn new email alerts and the alert sound on or off. Use when someone wants fewer interruptions, quiet time, or to stop the pings.',
  defaultVariant: 'panel',
  variants: {
    panel: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'setEmailNotifications',
          idempotent: true,
          description: 'Turn alerts for new emails on or off',
          parameters: [
            {
              name: 'on',
              type: 'boolean',
              description: 'True to get alerts, false to stop them',
            },
          ],
        },
        {
          name: 'setSound',
          idempotent: true,
          description: 'Turn the sound for new emails on or off',
          parameters: [
            {
              name: 'on',
              type: 'boolean',
              description: 'True to play a sound, false for silence',
            },
          ],
        },
      ],
    },
  },
});
