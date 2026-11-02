import { defineVessel } from '@maelstrom-co/protocol';
import { FEEDBACK_CHARACTER_LIMIT } from '../stores/feedback.store';

export const sourceFeedbackVessel = defineVessel({
  id: 'source-feedback',
  name: 'Feedback',
  description:
    'The product feedback the project is working from, shown as quoted text and kept visible as context while tasks are created from it. The user can edit it by hand. Use replaceFeedback when the user pastes new feedback or asks to replace it.',
  defaultVariant: 'snapshot',
  variants: {
    snapshot: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'replaceFeedback',
          idempotent: true,
          description: `Replace the feedback text with new text. Text over ${FEEDBACK_CHARACTER_LIMIT} characters is truncated.`,
          parameters: [
            {
              name: 'text',
              type: 'string',
              description: 'The full new feedback text.',
            },
          ],
        },
      ],
    },
  },
});
