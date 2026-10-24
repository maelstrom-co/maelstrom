import type { TextSize } from '../stores/settings.store';

export const MESSAGE_FONT_SIZE_PX: Readonly<Record<TextSize, number>> = {
  small: 15,
  medium: 17,
  large: 20,
  'extra-large': 24,
};
