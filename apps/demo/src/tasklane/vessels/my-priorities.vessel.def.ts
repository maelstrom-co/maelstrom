import { defineVessel } from '@maelstrom-co/protocol';
import {
  ADD_TO_MY_PRIORITIES_ACTION,
  REMOVE_FROM_MY_PRIORITIES_ACTION,
} from './task-action.defs';

// Typed as string so a republish can append live records to it.
const MY_PRIORITIES_DESCRIPTION: string =
  'My priorities: the current user Chris\'s own ordered list of tasks from the Tasks Vessel, top first. Show it when the user asks to see, review or reorder "my priorities". The list variant shows the full list with reorder and remove controls. The strip variant is a compact one-line view of the same list for a small space, for example under the Tasks board. Priorities are separate from urgency: reordering never changes a task\'s urgency.';

export const myPrioritiesVessel = defineVessel({
  id: 'my-priorities',
  name: 'My priorities',
  description: MY_PRIORITIES_DESCRIPTION,
  defaultVariant: 'list',
  variants: {
    list: {
      description:
        'The full ordered list, one row per task, with move up, move down and remove controls.',
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [ADD_TO_MY_PRIORITIES_ACTION, REMOVE_FROM_MY_PRIORITIES_ACTION],
    },
    strip: {
      description:
        'One compact line naming the priorities in order, without controls.',
      props: {},
      minSize: { width: 5, height: 1 },
      actions: [ADD_TO_MY_PRIORITIES_ACTION, REMOVE_FROM_MY_PRIORITIES_ACTION],
    },
  },
});
