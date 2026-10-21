import { defineVessel } from '@maelstrom-co/protocol';

export const signatureVessel = defineVessel({
  id: 'signature',
  name: 'Signature',
  description:
    'Setting. The sign-off added to the bottom of every email you send. Use when someone wants to change how they sign their emails.',
  defaultVariant: 'panel',
  variants: {
    panel: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'setSignature',
          idempotent: true,
          description: 'Replace the email signature',
          parameters: [
            {
              name: 'text',
              type: 'string',
              description: 'The full signature text',
            },
          ],
        },
      ],
    },
  },
});
