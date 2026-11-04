import type { TypedVesselProps } from '@maelstrom-co/react';
import { cn } from '../../lib/cn';
import { tasklaneM } from '../maelstrom';
import { plural } from '../plural';
import {
  boardFilterActions,
  EVERYONE,
  useBoardFilterStore,
} from '../stores/board-filter.store';
import {
  assigneeLabel,
  isOpenTask,
  isUrgentTask,
  type ProjectTask,
  useProjectTasksStore,
} from '../stores/project-tasks.store';
import { TEAM, type TeamMember } from '../stores/team';
import { reportBoardFilter } from '../task-action-receipts';
import { TasklaneCard } from '../tasklane-card';
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

  const open = tasks.filter(isOpenTask);
  const rows = TEAM.map((member) => memberLoad(member, open));

  return (
    <TasklaneCard title="Team load" meta={`${open.length} open`}>
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
                data-person={member.id}
                className="tasklane-load-row w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm"
                onClick={() =>
                  executeAction('filterByAssignee', {
                    assignee: active ? EVERYONE : member.id,
                  })
                }
              >
                <span className="tasklane-person w-12 shrink-0 truncate">
                  {member.name}
                </span>
                <span className="tasklane-load-track h-1.5 flex-1 rounded-full overflow-hidden">
                  <span
                    data-share={`${share}%`}
                    className="tasklane-load-fill block h-full rounded-full"
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
      {assigneeFilter ? (
        <p role="status" className="mt-1 shrink-0 text-xs text-ink-3">
          Board filtered to {assigneeLabel(assigneeFilter)}
        </p>
      ) : null}
    </TasklaneCard>
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
    urgent: mine.filter(isUrgentTask).length,
    share:
      open.length === 0 ? 0 : Math.round((mine.length / open.length) * 100),
  };
}
