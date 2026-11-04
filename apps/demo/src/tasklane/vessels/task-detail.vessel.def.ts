import { defineVessel } from '@maelstrom-co/protocol';

const TASK_DETAIL_DESCRIPTION =
  'One task from the Tasks Vessel in full: title, id, owner, urgency, status, parent, description, the feedback quote it came from, and its subtasks. Each Instance shows one task and stays empty until showTask runs on it. To open a task, for example "open TL-2" or "show me the README task", add a task-detail Instance to the layout and run showTask on that same Instance in the same response. To compare tasks, add one Instance per task. To switch an open Instance to another task, run showTask on it again.';

export const taskDetailVessel = defineVessel({
  id: 'task-detail',
  name: 'Task detail',
  description: TASK_DETAIL_DESCRIPTION,
  defaultVariant: 'card',
  variants: {
    card: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showTask',
          idempotent: true,
          description:
            'Show a task in this Instance. It only changes what this Instance shows, never the task.',
          parameters: [
            {
              name: 'task',
              type: 'string',
              description:
                'The task to show: a reference from the published list.',
            },
          ],
        },
      ],
    },
  },
});
