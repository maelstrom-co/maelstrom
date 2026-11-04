import type { TypedVesselProps } from '@maelstrom-co/react';
import { tasklaneM } from '../maelstrom';
import {
  type ProjectTask,
  projectTaskActions,
  useProjectTasksStore,
} from '../stores/project-tasks.store';
import { TEAM, UNASSIGNED } from '../stores/team';
import { reportTaskChange } from '../task-action-receipts';
import { TasklaneCard } from '../tasklane-card';
import type { triageInboxVessel } from './triage-inbox.vessel';

type ExecuteAction = TypedVesselProps<
  typeof triageInboxVessel
>['executeAction'];

type TriageReason = 'no owner' | 'no parent';

interface TriageItem {
  readonly task: ProjectTask;
  readonly reasons: readonly TriageReason[];
}

export default function TriageInboxComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof triageInboxVessel>) {
  const { tasks } = useProjectTasksStore();

  tasklaneM.useActions('triage-inbox', instanceId, {
    assignTask: async ({ task, assignee }) =>
      reportTaskChange(
        'assignTask',
        projectTaskActions.assignTask(task, assignee),
      ),
  });

  const items = triageItems(tasks);

  return (
    <TasklaneCard title="Triage inbox" meta={`${items.length} to sort`}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-sm text-ink-3">Inbox clear ✓</p>
        ) : (
          <ul aria-label="Triage inbox" className="space-y-1">
            {items.map((item) => (
              <TriageRow
                key={item.task.id}
                item={item}
                executeAction={executeAction}
              />
            ))}
          </ul>
        )}
      </div>
    </TasklaneCard>
  );
}

function TriageRow({
  item: { task, reasons },
  executeAction,
}: {
  readonly item: TriageItem;
  readonly executeAction: ExecuteAction;
}) {
  return (
    <li data-task-id={task.id} className="flex items-center gap-2 min-w-0">
      <span className="font-mono text-xs text-ink-3 shrink-0">{task.id}</span>
      <span className="min-w-0 flex-1 truncate text-sm" title={task.title}>
        {task.title}
      </span>
      {reasons.map((reason) => (
        <span
          key={reason}
          data-reason={reason}
          className="tasklane-reason shrink-0 rounded px-1.5 font-mono text-xs"
        >
          {reason}
        </span>
      ))}
      <select
        className="tasklane-select shrink-0"
        aria-label={`Assign ${task.title}`}
        data-person={task.assigneeId ?? UNASSIGNED}
        value={task.assigneeId ?? UNASSIGNED}
        onChange={(event) =>
          executeAction('assignTask', {
            task: task.id,
            assignee: event.target.value,
          })
        }
      >
        {TEAM.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
        <option value={UNASSIGNED}>Unassigned</option>
      </select>
    </li>
  );
}

// A top-level task with subtasks is already a group, so only a top-level task
// with nothing under it counts as loose. Done tasks need no triage.
function triageItems(tasks: readonly ProjectTask[]): TriageItem[] {
  const parentIds = new Set(tasks.map((task) => task.parentId));
  return tasks.flatMap((task) => {
    if (task.status === 'done') return [];
    const reasons: TriageReason[] = [];
    if (task.assigneeId === null) reasons.push('no owner');
    if (task.parentId === null && !parentIds.has(task.id))
      reasons.push('no parent');
    return reasons.length > 0 ? [{ task, reasons }] : [];
  });
}
