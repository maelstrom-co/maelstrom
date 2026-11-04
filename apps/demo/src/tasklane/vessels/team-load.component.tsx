import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../../components/vessel-card';
import { cn } from '../../lib/cn';
import { tasklaneM } from '../maelstrom';
import {
  boardFilterActions,
  EVERYONE,
  useBoardFilterStore,
} from '../stores/board-filter.store';
import {
  type ProjectTask,
  useProjectTasksStore,
} from '../stores/project-tasks.store';
import { TEAM, type TeamMember } from '../stores/team';
import { reportBoardFilter } from '../task-action-receipts';
import type { teamLoadVessel } from './team-load.vessel';

export default function TeamLoadComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof teamLoadVessel>) {
  const { tasks } = useProjectTasksStore();
  const { assigneeFilter } = useBoardFilterStore();

  tasklaneM.useActions('team-load', instanceId, {
    filterByAssignee: async ({ assignee }) =>
      reportBoardFilter(boardFilterActions.filterByAssignee(assignee)),
  });

  const open = tasks.filter((task) => task.status !== 'done');
  const rows = TEAM.map((member) => memberLoad(member, open));

  return (
    <VesselCard accent="brand" label="Team load" meta={`${open.length} open`}>
      <ul aria-label="Team load" className="flex-1 min-h-0 overflow-y-auto">
        {rows.map(({ member, count, urgent, share }) => {
          const active = assigneeFilter === member.id;
          return (
            <li key={member.id} data-member-id={member.id}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${member.name}, ${plural(count, 'open task')}, ${urgent} urgent`}
                data-active={active}
                className={cn(
                  'w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                  'hover:bg-white/5 focus-visible:outline focus-visible:outline-1',
                  active && 'bg-white/10 ring-1 ring-brand',
                )}
                onClick={() =>
                  executeAction('filterByAssignee', {
                    assignee: active ? EVERYONE : member.id,
                  })
                }
              >
                <span className="w-12 shrink-0 truncate">{member.name}</span>
                <span className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
                  <span
                    data-share={`${share}%`}
                    className="block h-full rounded-full bg-brand"
                    style={{ width: `${share}%` }}
                  />
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-2">
                  {plural(count, 'task')}
                </span>
                <span
                  className={cn(
                    'w-14 shrink-0 text-right font-mono text-xs',
                    urgent > 0 ? 'text-amber' : 'text-ink-3',
                  )}
                >
                  {urgent} urgent
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </VesselCard>
  );
}

interface MemberLoad {
  readonly member: TeamMember;
  readonly count: number;
  readonly urgent: number;
  /** Whole-number percentage of all open tasks, unassigned ones included. */
  readonly share: number;
}

function memberLoad(
  member: TeamMember,
  open: readonly ProjectTask[],
): MemberLoad {
  const mine = open.filter((task) => task.assigneeId === member.id);
  return {
    member,
    count: mine.length,
    urgent: mine.filter((task) => task.urgency === 'high').length,
    share:
      open.length === 0 ? 0 : Math.round((mine.length / open.length) * 100),
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
