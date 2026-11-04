import { defineVessel } from '@maelstrom-co/protocol';
import { NO_PARENT, TASK_URGENCIES } from '../stores/project-tasks.store';
import { ASSIGNEE_CHOICES } from '../stores/team';

const TASK_REFERENCE =
  'The task to change: a reference from the published list (id, title and status), or the task id such as TL-3.';

// Typed as string so a republish can append live records to it.
const PROJECT_TASKS_DESCRIPTION: string =
  'The task list of the "Maelstrom demo" project in Tasklane. Real task records with a parent and child hierarchy, a title, a description, an assignee from the team (Chris, Alex, Sam) and an urgency (low, normal or high). It also shows "My priorities", the current user Chris\'s own ordered list of tasks. "Me", "my" and "I" mean Chris. Personal priorities are separate from urgency: adding a task to my priorities never changes its urgency. Use setParent to group tasks under a parent task. The user edits every field by hand too, so always act on the current values.';

export const projectTasksVessel = defineVessel({
  id: 'project-tasks',
  name: 'Tasks',
  description: PROJECT_TASKS_DESCRIPTION,
  defaultVariant: 'board',
  variants: {
    board: {
      props: {},
      minSize: { width: 5, height: 4 },
      actions: [
        {
          name: 'createTask',
          description:
            'Create a task. Actions run in plan order, so a parent created earlier in the same plan can be named by its title in parent.',
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
              description: 'Team id of the assignee. chris is me.',
            },
            {
              name: 'urgency',
              type: 'string',
              required: false,
              enum: [...TASK_URGENCIES],
              description: 'How urgent the task is. Defaults to normal.',
            },
          ],
        },
        {
          name: 'updateTask',
          idempotent: true,
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
          idempotent: true,
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
        {
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
        },
        {
          name: 'setUrgency',
          idempotent: true,
          description:
            "Set a task's urgency. This is not the same as my priorities.",
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
        },
        {
          name: 'removeFromMyPriorities',
          idempotent: true,
          description:
            "Take a task out of Chris's personal priorities list. The task itself stays.",
          parameters: [
            { name: 'task', type: 'string', description: TASK_REFERENCE },
          ],
        },
        {
          name: 'removeTask',
          description:
            'Delete a task. Its children move to the top level instead of being deleted.',
          parameters: [
            { name: 'task', type: 'string', description: TASK_REFERENCE },
          ],
        },
      ],
    },
  },
});
