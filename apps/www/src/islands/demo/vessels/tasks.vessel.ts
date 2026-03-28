import { defineVessel } from '@maelstrom-co/protocol-old';

export const tasksVessel = defineVessel({
  id: 'tasks',
  name: 'Tasks',
  description: 'Task list with checkboxes.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        {
          name: 'addTask',
          description: 'Add a new task to the list',
          parameters: [
            { name: 'title', type: 'string', description: 'Task title' },
          ],
        },
      ],
    },
  },
});
