import type { VesselActionDefinition } from '@maelstrom-co/protocol';
import { EVERYONE } from '../stores/board-filter.store';
import { ASSIGNEE_CHOICES, TEAM_MEMBER_IDS } from '../stores/team';

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

/** Declared by every Vessel that can assign tasks, so the Planner can use whichever is on screen. */
export const ASSIGN_TASK_ACTION = {
  name: 'assignTask',
  idempotent: true,
  description: 'Assign a task to a team member, or unassign it.',
  parameters: [
    { name: 'task', type: 'string', description: TASK_REFERENCE },
    {
      name: 'assignee',
      type: 'string',
      enum: [...ASSIGNEE_CHOICES],
      description: 'Team id of the new assignee. chris is me.',
    },
  ],
} as const satisfies VesselActionDefinition;

/** Declared by every Vessel that can narrow the Tasks board to one team member. */
export const FILTER_BY_ASSIGNEE_ACTION = {
  name: 'filterByAssignee',
  idempotent: true,
  description: `Show only one team member's tasks on the board, or pass ${EVERYONE} to show every task again. It changes only what the board shows, never the tasks.`,
  parameters: [
    {
      name: 'assignee',
      type: 'string',
      enum: [...TEAM_MEMBER_IDS, EVERYONE],
      description: `Team id whose tasks to show, or ${EVERYONE}. chris is me.`,
    },
  ],
} as const satisfies VesselActionDefinition;
