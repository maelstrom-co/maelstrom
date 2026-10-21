import { defineVessel } from '@maelstrom-co/protocol';
import { TEXT_SIZE_DIRECTIONS, TEXT_SIZES } from '../stores/settings.store';

export const textSizeVessel = defineVessel({
  id: 'text-size',
  name: 'Text size',
  description:
    'Setting. Make the email text bigger or smaller. Use when someone says the text is too small, wants bigger text, or a larger font.',
  defaultVariant: 'panel',
  variants: {
    panel: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'setTextSize',
          idempotent: true,
          description: 'Set the email text to a specific size',
          parameters: [
            {
              name: 'size',
              type: 'string',
              description: 'The text size to use',
              enum: [...TEXT_SIZES],
            },
          ],
        },
        {
          name: 'adjustTextSize',
          description: 'Make the email text one step bigger or smaller',
          parameters: [
            {
              name: 'direction',
              type: 'string',
              description: 'Which way to change the text size',
              enum: [...TEXT_SIZE_DIRECTIONS],
            },
          ],
        },
      ],
    },
  },
});
