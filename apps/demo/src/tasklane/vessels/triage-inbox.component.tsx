import type { TypedVesselProps } from '@maelstrom-co/react';
import { tasklaneM } from '../maelstrom';
import { AssigneeSelect } from '../person-chip';
import {
  isOpenTask,
  type ProjectTask,
  projectTaskActions,
  useProjectTasksStore,
} from '../stores/project-tasks.store';
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
      <AssigneeSelect
        task={task}
        label={`Assign ${task.title}`}
        className="shrink-0"
        onAssign={(assignee) =>
          executeAction('assignTask', { task: task.id, assignee })
        }
      />
    </li>
  );
}

// A top-level task with subtasks is already a group, so only a top-level task
// with nothing under it counts as loose. Done tasks need no triage.
function triageItems(tasks: readonly ProjectTask[]): TriageItem[] {
  const parentIds = new Set(tasks.map((task) => task.parentId));
  return tasks.flatMap((task) => {
    if (!isOpenTask(task)) return [];
    const reasons: TriageReason[] = [];
    if (task.assigneeId === null) reasons.push('no owner');
    if (task.parentId === null && !parentIds.has(task.id))
      reasons.push('no parent');
    return reasons.length > 0 ? [{ task, reasons }] : [];
  });
}
