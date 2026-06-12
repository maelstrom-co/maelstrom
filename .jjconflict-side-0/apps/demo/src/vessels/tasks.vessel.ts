import { defineVessel } from '@maelstrom-co/protocol';
import { vessel } from '@maelstrom-co/react';
import { TasksSkeleton } from './tasks.skeleton';

export const tasksVessel = defineVessel({
  id: 'tasks',
  name: 'Tasks',
  description:
    'Task list with checkboxes, subtasks, and progress tracking. Supports adding, removing, checking, and nesting tasks.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'addTask',
          description: 'Add a new task to the list',
          parameters: [
            { name: 'title', type: 'string', description: 'Task title' },
          ],
        },
        {
          name: 'removeTask',
          description: 'Remove a task by title',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the task to remove',
            },
          ],
        },
        {
          name: 'checkTask',
          description: 'Mark a task as complete',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the task to check',
            },
          ],
        },
        {
          name: 'uncheckTask',
          description: 'Mark a task as incomplete',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the task to uncheck',
            },
          ],
        },
        {
          name: 'addSubtask',
          description: 'Add a subtask under an existing task',
          parameters: [
            {
              name: 'taskTitle',
              type: 'string',
              description: 'Title of the parent task',
            },
            {
              name: 'subtaskTitle',
              type: 'string',
              description: 'Title of the subtask to add',
            },
          ],
        },
      ],
    },
  },
});

export const tasksEntry = vessel(
  tasksVessel,
  () => import('./tasks.component'),
  TasksSkeleton,
);
