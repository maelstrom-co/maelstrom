import {
  defineVessel,
  type VesselActionDefinition,
} from '@maelstrom-co/protocol';

import {
  NO_PARENT,
  TASK_STATUSES,
  TASK_URGENCIES,
} from '../stores/project-tasks.store';
import { ASSIGNEE_CHOICES, UNASSIGNED } from '../stores/team';
import {
  ADD_TO_MY_PRIORITIES_ACTION,
  ASSIGN_TASK_ACTION,
  FILTER_BY_ASSIGNEE_ACTION,
  REMOVE_FROM_MY_PRIORITIES_ACTION,
  TASK_REFERENCE,
} from './task-action.defs';

// Typed as string so a republish can append live records to it.
const PROJECT_TASKS_DESCRIPTION: string =
  'The task list of the "Maelstrom demo" project in Tasklane. Real task records with a parent and child hierarchy, a title, a description, an assignee from the team (Chris, Alex, Sam), an urgency (low, normal or high), a status (todo, doing or done) and, when it came from the feedback, the feedback quote it came from. A star badge with a number marks each task in "My priorities", the current user Chris\'s own ordered list, and the separate My priorities Vessel shows that list in full. "Me", "my" and "I" mean Chris. Personal priorities are separate from urgency: adding a task to my priorities never changes its urgency. Use setParent to group tasks under a parent task. Two views: the board variant lists tasks as a hierarchy, the columns variant groups them into To do, In progress and Done columns and needs a wide space. Both can show only one team member\'s tasks through filterByAssignee, for example "show Alex\'s tasks". The user edits every field by hand too, so always act on the current values.';

const PROJECT_TASK_ACTIONS = [
  {
    name: 'createTask',
    description:
      'Create a task. Actions on this Instance run in plan order, so a parent created earlier in the same plan can be named by its title in parent.',
    parameters: [
      {
        name: 'title',
        type: 'string',
        description: 'Short task title.',
      },
      {
        name: 'description',
        type: 'string',
        required: false,
        description: 'What the task covers, one or two sentences.',
      },
      {
        name: 'parent',
        type: 'string',
        required: false,
        description: `Parent task id or exact title. Omit or pass ${NO_PARENT} for a top-level task.`,
      },
      {
        name: 'assignee',
        type: 'string',
        required: false,
        enum: [...ASSIGNEE_CHOICES],
        description: `Team id of the assignee, or ${UNASSIGNED} for no owner. chris is me.`,
      },
      {
        name: 'urgency',
        type: 'string',
        required: false,
        enum: [...TASK_URGENCIES],
        description: 'How urgent the task is. Defaults to normal.',
      },
      {
        name: 'source',
        type: 'string',
        required: false,
        description:
          'The exact feedback quote this task comes from, copied from the feedback text. Omit when the task does not come from feedback.',
      },
    ],
  },
  {
    name: 'updateTask',
    effect: 'idempotent',
    description:
      "Change a task's title or description. Pass only the fields that change.",
    parameters: [
      { name: 'task', type: 'string', description: TASK_REFERENCE },
      {
        name: 'title',
        type: 'string',
        required: false,
        description: 'New title.',
      },
      {
        name: 'description',
        type: 'string',
        required: false,
        description: 'New description, replacing the old one.',
      },
    ],
  },
  {
    name: 'setParent',
    effect: 'idempotent',
    description: `Move a task under a parent task to group it, or pass ${NO_PARENT} to make it top level. A task cannot go under itself or its own children.`,
    parameters: [
      { name: 'task', type: 'string', description: TASK_REFERENCE },
      {
        name: 'parent',
        type: 'string',
        description: `Parent task id or title, or ${NO_PARENT}.`,
      },
    ],
  },
  ASSIGN_TASK_ACTION,
  {
    name: 'setUrgency',
    effect: 'idempotent',
    description: "Set a task's urgency. This is not the same as my priorities.",
    parameters: [
      { name: 'task', type: 'string', description: TASK_REFERENCE },
      {
        name: 'urgency',
        type: 'string',
        enum: [...TASK_URGENCIES],
        description: 'New urgency.',
      },
    ],
  },
  {
    name: 'setStatus',
    effect: 'idempotent',
    description:
      'Move a task to todo, doing (in progress) or done. Use it when the user starts, finishes or reopens a task.',
    parameters: [
      { name: 'task', type: 'string', description: TASK_REFERENCE },
      {
        name: 'status',
        type: 'string',
        enum: [...TASK_STATUSES],
        description: 'New status.',
      },
    ],
  },
  ADD_TO_MY_PRIORITIES_ACTION,
  REMOVE_FROM_MY_PRIORITIES_ACTION,
  {
    name: 'removeTask',
    description:
      'Delete a task. Its children move to the top level instead of being deleted.',
    parameters: [{ name: 'task', type: 'string', description: TASK_REFERENCE }],
  },
  FILTER_BY_ASSIGNEE_ACTION,
] as const satisfies readonly VesselActionDefinition[];

export const projectTasksVessel = defineVessel({
  id: 'project-tasks',
  name: 'Tasks',
  description: PROJECT_TASKS_DESCRIPTION,
  defaultVariant: 'board',
  variants: {
    board: {
      description: 'Tasks as a hierarchy, parents above their children.',
      props: {},
      minSize: { width: 5, height: 4 },
      actions: PROJECT_TASK_ACTIONS,
    },
    columns: {
      description:
        'Tasks in To do, In progress and Done columns by status. Needs a wide space.',
      props: {},
      minSize: { width: 9, height: 4 },
      actions: PROJECT_TASK_ACTIONS,
    },
  },
});
