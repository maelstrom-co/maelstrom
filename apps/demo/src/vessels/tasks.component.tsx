import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { Check } from 'lucide-react';

import { VesselCard } from '../components/vessel-card';
import {
  describeAddedTask,
  markDirectAction,
  recordChange,
  recordFailure,
  recordUnchanged,
} from '../lib/action-activity';
import { cn } from '../lib/cn';
import { VESSEL_ACCENTS } from '../lib/design-tokens';
import { m } from '../lib/maelstrom';
import {
  getTasksSnapshot,
  type SubtaskChange,
  type TaskChange,
  taskReferenceLabel,
  tasksActions,
  useTasksStore,
} from './tasks.store';
import type { tasksVessel } from './tasks.vessel';

export default function TasksComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof tasksVessel>) {
  const { tasks } = useTasksStore();

  m.useActions('tasks', instanceId, {
    addTask: async ({ title, subtasks }) => {
      const result = tasksActions.addTask(title, splitSubtaskTitles(subtasks));
      recordChange(
        describeAddedTask(result.task.title, result.task.subtasks.length),
        source('addTask'),
      );
      return ok(undefined);
    },
    removeTask: async ({ task }) =>
      taskOutcome(
        'removeTask',
        tasksActions.removeTask(task),
        (changed) => `Removed task "${changed.title}"`,
      ),
    checkTask: async ({ task }) =>
      taskOutcome(
        'checkTask',
        tasksActions.setTaskDone(task, true),
        (changed) => `Checked task "${changed.title}"`,
      ),
    uncheckTask: async ({ task }) =>
      taskOutcome(
        'uncheckTask',
        tasksActions.setTaskDone(task, false),
        (changed) => `Unchecked task "${changed.title}"`,
      ),
    addSubtask: async ({ task, subtaskTitle }) =>
      subtaskOutcome(
        'addSubtask',
        'task',
        tasksActions.addSubtask(task, subtaskTitle),
        (result) =>
          `Added subtask "${result.subtask.title}" to "${result.task.title}"`,
      ),
    checkSubtask: async ({ subtask }) =>
      subtaskOutcome(
        'checkSubtask',
        'subtask',
        tasksActions.setSubtaskDone(subtask, true),
        (result) => `Checked subtask "${result.subtask.title}"`,
      ),
    uncheckSubtask: async ({ subtask }) =>
      subtaskOutcome(
        'uncheckSubtask',
        'subtask',
        tasksActions.setSubtaskDone(subtask, false),
        (result) => `Unchecked subtask "${result.subtask.title}"`,
      ),
  });

  const allItems = tasks.flatMap((t) => [t, ...t.subtasks]);
  const doneCount = allItems.filter((t) => t.done).length;
  const totalCount = allItems.length;
  const progress = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  return (
    <VesselCard
      accent={VESSEL_ACCENTS.tasks}
      label="Tasks"
      meta={`${doneCount}/${totalCount}`}
    >
      {/* Progress bar — the vessel's one material moment: a liquid glass tube */}
      <div className="task-tube mb-3">
        <div className="task-tube-fill" style={{ width: `${progress}%` }} />
      </div>

      {tasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-1">
          <p className="text-sm text-ink-3">No tasks yet</p>
          <p className="text-xs font-mono text-ink-3">
            Try: &ldquo;Add a task to prep the design review&rdquo;
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto">
          {tasks.map((task) => (
            <div key={task.id}>
              <div className="flex items-center gap-2.5">
                <TaskCheckbox
                  title={task.title}
                  done={task.done}
                  onToggle={() => {
                    const action = task.done ? 'uncheckTask' : 'checkTask';
                    markDirectAction(source(action));
                    executeAction(action, { task: task.id });
                  }}
                />
                <span
                  className={
                    task.done
                      ? 'text-sm text-ink-3 line-through'
                      : 'text-sm text-ink'
                  }
                >
                  {task.title}
                </span>
              </div>

              {task.subtasks.length > 0 && (
                <div className="ml-6 mt-1 space-y-1.5">
                  {task.subtasks.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center gap-2 animate-fade-in"
                    >
                      <TaskCheckbox
                        title={sub.title}
                        done={sub.done}
                        subtask
                        onToggle={() => {
                          const action = sub.done
                            ? 'uncheckSubtask'
                            : 'checkSubtask';
                          markDirectAction(source(action));
                          executeAction(action, { subtask: sub.id });
                        }}
                      />
                      <span
                        className={
                          sub.done
                            ? 'text-xs text-ink-3 line-through'
                            : 'text-xs text-ink-2'
                        }
                      >
                        {sub.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </VesselCard>
  );
}

const SUBTASK_SEPARATOR = '|';

function TaskCheckbox({
  title,
  done,
  subtask = false,
  onToggle,
}: {
  title: string;
  done: boolean;
  subtask?: boolean;
  onToggle: () => void;
}) {
  // The native input sits transparently over the drawn glass box, so it
  // keeps native checkbox semantics, Space handling and the click target.
  return (
    <span className="task-check-control shrink-0">
      <input
        type="checkbox"
        checked={done}
        aria-label={title}
        onChange={onToggle}
        className="task-check-input"
      />
      <span
        aria-hidden="true"
        className={cn(
          'task-check',
          subtask && 'task-check-sub',
          done && 'task-check--done',
        )}
      >
        {done && (
          <Check
            size={subtask ? 9 : 10}
            strokeWidth={1.75}
            className="text-bg"
          />
        )}
      </span>
    </span>
  );
}

function source(action: string) {
  return { vesselId: 'tasks', action };
}

function splitSubtaskTitles(subtasks: string | undefined): string[] {
  if (!subtasks) return [];
  return subtasks.split(SUBTASK_SEPARATOR);
}

function taskOutcome(
  action: string,
  result: TaskChange,
  describe: (task: { title: string }) => string,
) {
  if (!result.ok) return notFound(action, 'task', result.query);
  if (result.changed) {
    recordChange(describe(result.task), source(action));
  } else {
    recordUnchanged(alreadyText(result.task), source(action));
  }
  return ok(undefined);
}

function subtaskOutcome(
  action: string,
  kind: 'task' | 'subtask',
  result: SubtaskChange,
  describe: (result: Extract<SubtaskChange, { ok: true }>) => string,
) {
  if (!result.ok && result.reason === 'blank_title') {
    recordFailure("Couldn't add a subtask without a title", source(action));
    return err(new Error('subtaskTitle must not be blank'));
  }
  if (!result.ok) return notFound(action, kind, result.query);
  if (result.changed) {
    recordChange(describe(result), source(action));
  } else {
    recordUnchanged(alreadyText(result.subtask), source(action));
  }
  return ok(undefined);
}

function alreadyText(item: { title: string; done: boolean }): string {
  return `"${item.title}" was already ${item.done ? 'done' : 'open'}`;
}

function notFound(action: string, kind: 'task' | 'subtask', query: string) {
  recordFailure(`Couldn't find ${kind} "${query}"`, source(action));
  const { tasks } = getTasksSnapshot();
  const references =
    kind === 'task'
      ? tasks.map(taskReferenceLabel)
      : tasks.flatMap((task) => task.subtasks.map(taskReferenceLabel));
  const available =
    references.length > 0 ? references.map((r) => `"${r}"`).join(', ') : 'none';
  return err(
    new Error(`No ${kind} matches "${query}". Available: ${available}`),
  );
}
