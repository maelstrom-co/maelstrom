import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { Check } from 'lucide-react';
import { VesselCard } from '../components/vessel-card';
import { cn } from '../lib/cn';
import { VESSEL_ACCENTS } from '../lib/design-tokens';
import { m } from '../lib/maelstrom';
import { getTasksSnapshot, tasksActions, useTasksStore } from './tasks.store';
import type { tasksVessel } from './tasks.vessel';

function noMatchError(title: string): Error {
  const available = getTasksSnapshot()
    .tasks.map((t) => `"${t.title}"`)
    .join(', ');
  return new Error(`No task matches "${title}". Available: ${available}`);
}

export default function TasksComponent({
  instanceId,
}: TypedVesselProps<typeof tasksVessel>) {
  const { tasks } = useTasksStore();

  m.useActions('tasks', instanceId, {
    addTask: async ({ title }) => {
      tasksActions.addTask(title);
      return ok(undefined);
    },
    removeTask: async ({ title }) => {
      if (!tasksActions.removeTask(title)) return err(noMatchError(title));
      return ok(undefined);
    },
    checkTask: async ({ title }) => {
      if (!tasksActions.checkTask(title)) return err(noMatchError(title));
      return ok(undefined);
    },
    uncheckTask: async ({ title }) => {
      if (!tasksActions.uncheckTask(title)) return err(noMatchError(title));
      return ok(undefined);
    },
    addSubtask: async ({ taskTitle, subtaskTitle }) => {
      if (!tasksActions.addSubtask(taskTitle, subtaskTitle)) {
        return err(noMatchError(taskTitle));
      }
      return ok(undefined);
    },
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
              {/* Task */}
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    'task-check shrink-0',
                    task.done && 'task-check--done',
                  )}
                >
                  {task.done && (
                    <Check size={10} strokeWidth={1.75} className="text-bg" />
                  )}
                </div>
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

              {/* Subtasks */}
              {task.subtasks.length > 0 && (
                <div className="ml-6 mt-1 space-y-1.5">
                  {task.subtasks.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center gap-2 animate-fade-in"
                    >
                      <div
                        className={cn(
                          'task-check task-check-sub shrink-0',
                          sub.done && 'task-check--done',
                        )}
                      >
                        {sub.done && (
                          <Check
                            size={9}
                            strokeWidth={1.75}
                            className="text-bg"
                          />
                        )}
                      </div>
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
