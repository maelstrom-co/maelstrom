import type { VesselActionDefinition } from '@maelstrom-co/protocol';

export const TASK_REFERENCE =
  'The task to change: a reference from the published list (id, title and status), or the task id such as TL-3.';

/** Declared by every Vessel that can change Chris's priorities, so the Planner can use whichever is on screen. */
export const ADD_TO_MY_PRIORITIES_ACTION = {
  name: 'addToMyPriorities',
  idempotent: true,
  description:
    "Put a task in Chris's personal priorities list, at the end or at a position. A task already in the list moves to the position. Urgency is unchanged.",
  parameters: [
    { name: 'task', type: 'string', description: TASK_REFERENCE },
    {
      name: 'position',
      type: 'number',
      required: false,
      description:
        '1-based place in my priorities, 1 is the top. Omit to add at the end.',
    },
  ],
} as const satisfies VesselActionDefinition;

export const REMOVE_FROM_MY_PRIORITIES_ACTION = {
  name: 'removeFromMyPriorities',
  idempotent: true,
  description:
    "Take a task out of Chris's personal priorities list. The task itself stays.",
  parameters: [{ name: 'task', type: 'string', description: TASK_REFERENCE }],
} as const satisfies VesselActionDefinition;
