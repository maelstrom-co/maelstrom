import { defineVessel } from '@maelstrom-co/protocol';
import { THEMES } from '../stores/settings.store';

export const themeVessel = defineVessel({
  id: 'theme',
  name: 'Theme',
  description:
    'Setting. Change how the mail app looks: light, dark, or a warm sepia. Use when someone says the screen is too bright, wants dark mode, or wants it easier on the eyes. Show it whenever someone wants to change how the email or the app looks, even before they pick a look, so they can choose on screen.',
  defaultVariant: 'panel',
  variants: {
    panel: {
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [
        {
          name: 'setTheme',
          idempotent: true,
          description: 'Switch the app to a theme',
          parameters: [
            {
              name: 'theme',
              type: 'string',
              description: 'The theme to use',
              enum: [...THEMES],
            },
          ],
        },
      ],
    },
  },
});
