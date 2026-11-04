import { defineVessel } from '@maelstrom-co/protocol';

const PROJECT_PULSE_DESCRIPTION =
  'Project pulse: a small read-only tile with the health of the "Maelstrom demo" project at a glance. It shows the total task count, how many open tasks are urgent (high), how many open tasks have no owner, and the percent of tasks that are done. Show it when the user asks for the project pulse, a project overview or status, how the project is going, or how much is done. It has no Actions.';

export const projectPulseVessel = defineVessel({
  id: 'project-pulse',
  name: 'Project pulse',
  description: PROJECT_PULSE_DESCRIPTION,
  defaultVariant: 'tile',
  variants: {
    tile: {
      description: 'Tasks, Urgent, Unowned and Done percent as four tiles.',
      props: {},
      minSize: { width: 2, height: 2 },
      actions: [],
    },
  },
});
