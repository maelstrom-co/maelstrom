import { defineVessel } from '@maelstrom-co/protocol';
import { FILTER_BY_ASSIGNEE_ACTION } from './task-action.defs';

const TEAM_LOAD_DESCRIPTION =
  'Team load: how the open tasks (not done) of the "Maelstrom demo" project are spread across the team (Chris, Alex, Sam). One row per team member with a bar for their share of all open tasks, their open task count and how many of those are urgent (high). Show it when the user asks who is overloaded, who has the most work, how the work is spread, or for the team load or workload. Clicking a person shows only their tasks on the Tasks board, and clicking them again shows everyone. filterByAssignee does the same from a request, for example "show Sam\'s tasks".';

export const teamLoadVessel = defineVessel({
  id: 'team-load',
  name: 'Team load',
  description: TEAM_LOAD_DESCRIPTION,
  defaultVariant: 'bars',
  variants: {
    bars: {
      description:
        'One compact bar row per team member, which filters the board when clicked.',
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [FILTER_BY_ASSIGNEE_ACTION],
    },
  },
});
