import type { TypedVesselProps } from '@maelstrom-co/react';
import { tasklaneM } from '../maelstrom';
import { PersonChip } from '../person-chip';
import {
  type ProjectTask,
  projectTaskActions,
  useProjectTasksStore,
} from '../stores/project-tasks.store';
import { reportPriorityChange } from '../task-action-receipts';
import { TasklaneCard } from '../tasklane-card';
import type { myPrioritiesVessel } from './my-priorities.vessel';

type ExecuteAction = TypedVesselProps<
  typeof myPrioritiesVessel
>['executeAction'];

export default function MyPrioritiesComponent({
  instanceId,
  variantProps,
  executeAction,
}: TypedVesselProps<typeof myPrioritiesVessel>) {
  const { tasks, myPriorities } = useProjectTasksStore();

  tasklaneM.useActions('my-priorities', instanceId, {
    addToMyPriorities: async ({ task, position }) =>
      reportPriorityChange(
        'addToMyPriorities',
        projectTaskActions.addToMyPriorities(task, position),
      ),
    removeFromMyPriorities: async ({ task }) =>
      reportPriorityChange(
        'removeFromMyPriorities',
        projectTaskActions.removeFromMyPriorities(task),
      ),
  });

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const prioritised = myPriorities.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });

  if (variantProps.variant === 'strip')
    return <PriorityStrip prioritised={prioritised} />;

  return (
    <TasklaneCard
      title="My priorities"
      meta={`${prioritised.length} task${prioritised.length === 1 ? '' : 's'}`}
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        {prioritised.length === 0 ? (
          <p className="text-xs text-ink-3">No tasks in your priorities yet.</p>
        ) : (
          <ol aria-label="My priorities" className="tasklane-priority-list">
            {prioritised.map((task, index) => (
              <PriorityRow
                key={task.id}
                task={task}
                index={index}
                last={index === prioritised.length - 1}
                executeAction={executeAction}
              />
            ))}
          </ol>
        )}
      </div>
    </TasklaneCard>
  );
}

interface PriorityRowProps {
  readonly task: ProjectTask;
  readonly index: number;
  readonly last: boolean;
  readonly executeAction: ExecuteAction;
}

function PriorityRow({ task, index, last, executeAction }: PriorityRowProps) {
  return (
    <li data-task-id={task.id} className="tasklane-priority">
      <span className="tasklane-priority-rank">{index + 1}</span>
      <span className="font-mono text-xs text-ink-3 shrink-0">{task.id}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
      <PersonChip memberId={task.assigneeId} />
      <button
        type="button"
        className="tasklane-icon-button"
        aria-label={`Move ${task.title} up`}
        disabled={index === 0}
        onClick={() =>
          executeAction('addToMyPriorities', {
            task: task.id,
            position: index,
          })
        }
      >
        ↑
      </button>
      <button
        type="button"
        className="tasklane-icon-button"
        aria-label={`Move ${task.title} down`}
        disabled={last}
        onClick={() =>
          executeAction('addToMyPriorities', {
            task: task.id,
            position: index + 2,
          })
        }
      >
        ↓
      </button>
      <button
        type="button"
        className="tasklane-icon-button"
        aria-label={`Remove ${task.title} from my priorities`}
        onClick={() =>
          executeAction('removeFromMyPriorities', { task: task.id })
        }
      >
        ×
      </button>
    </li>
  );
}

// The strip has no room for the card header and padding, so it draws its own
// one-line frame on the same surface.
function PriorityStrip({
  prioritised,
}: {
  readonly prioritised: readonly ProjectTask[];
}) {
  return (
    <div className="tasklane-surface tasklane-priority-strip">
      <span className="tasklane-priority-strip-label">My priorities</span>
      {prioritised.length === 0 ? (
        <span className="text-xs text-ink-3">None yet</span>
      ) : (
        <ol aria-label="My priorities" className="tasklane-priority-strip-list">
          {prioritised.map((task, index) => (
            <li
              key={task.id}
              data-task-id={task.id}
              className="tasklane-priority-strip-item"
              title={`${task.id} ${task.title}`}
            >
              <span className="tasklane-priority-rank">{index + 1}</span>
              {task.title}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
