import { defineVessel } from '@maelstrom-co/protocol';

const TASK_REFERENCE =
  'Task reference from the published list (id, title and open or done status), for example "T-2 Prep design review notes (open)"';
const SUBTASK_REFERENCE =
  'Subtask reference from the published list (id, title and open or done status), for example "T-4.1 Check prototype (open)"';

export const tasksVessel = defineVessel({
  id: 'tasks',
  name: 'Tasks',
  description:
    'Task list with subtasks and progress tracking. The user can check and uncheck tasks and subtasks directly, and the same changes can be made by request. Supports adding tasks with subtasks, removing, checking and nesting tasks.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'addTask',
          description:
            'Add a new task, optionally with subtasks created at the same time',
          parameters: [
            { name: 'title', type: 'string', description: 'Task title' },
            {
              name: 'subtasks',
              type: 'string',
              required: false,
              description:
                'Optional subtask titles separated by " | ", for example "Check prototype | Write questions"',
            },
          ],
        },
        {
          name: 'removeTask',
          description: 'Remove a task',
          parameters: [
            { name: 'task', type: 'string', description: TASK_REFERENCE },
          ],
        },
        {
          name: 'checkTask',
          description: 'Mark a task as done',
          parameters: [
            { name: 'task', type: 'string', description: TASK_REFERENCE },
          ],
        },
        {
          name: 'uncheckTask',
          description: 'Mark a task as open again',
          parameters: [
            { name: 'task', type: 'string', description: TASK_REFERENCE },
          ],
        },
        {
          name: 'addSubtask',
          description: 'Add a subtask under an existing task',
          parameters: [
            {
              name: 'task',
              type: 'string',
              description: `Parent task. ${TASK_REFERENCE}`,
            },
            {
              name: 'subtaskTitle',
              type: 'string',
              description: 'Title of the subtask to add',
            },
          ],
        },
        {
          name: 'checkSubtask',
          description: 'Mark a subtask as done',
          parameters: [
            { name: 'subtask', type: 'string', description: SUBTASK_REFERENCE },
          ],
        },
        {
          name: 'uncheckSubtask',
          description: 'Mark a subtask as open again',
          parameters: [
            { name: 'subtask', type: 'string', description: SUBTASK_REFERENCE },
          ],
        },
      ],
    },
  },
});
