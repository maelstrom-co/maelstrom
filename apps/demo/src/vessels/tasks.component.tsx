import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../components/vessel-card';
import { m } from '../lib/maelstrom';
import { getTasksSnapshot, tasksActions, useTasksStore } from './tasks.store';
import type { tasksVessel } from './tasks.vessel';

function noMatchError(title: string): Error {
  const available = getTasksSnapshot()
    .tasks.map((t) => `"${t.title}"`)
    .join(', ');
  return new Error(`No task matches "${title}". Available: ${available}`);
}

function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(107, 0, 255, 0.7)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
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
      accent="violet"
      label="Tasks"
      meta={`${doneCount}/${totalCount}`}
    >
      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-violet-accent/8 mb-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            background:
              'linear-gradient(90deg, rgba(107, 0, 255, 0.4), rgba(107, 0, 255, 0.7))',
            boxShadow: '0 0 8px rgba(107, 0, 255, 0.3)',
          }}
        />
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {tasks.map((task) => (
          <div key={task.id}>
            {/* Task */}
            <div className="flex items-center gap-2.5">
              <div
                className={
                  task.done
                    ? 'w-4 h-4 rounded shrink-0 flex items-center justify-center border-[1.5px] border-violet-accent/50 bg-violet-accent/15'
                    : 'w-4 h-4 rounded shrink-0 flex items-center justify-center border-[1.5px] border-violet-accent/25'
                }
              >
                {task.done && <CheckIcon />}
              </div>
              <span
                className={
                  task.done
                    ? 'text-sm text-gray-500 line-through'
                    : 'text-sm text-white/80'
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
                      className={
                        sub.done
                          ? 'w-3 h-3 rounded-sm shrink-0 flex items-center justify-center border border-violet-accent/50 bg-violet-accent/15'
                          : 'w-3 h-3 rounded-sm shrink-0 flex items-center justify-center border border-violet-accent/25'
                      }
                    >
                      {sub.done && <CheckIcon />}
                    </div>
                    <span
                      className={
                        sub.done
                          ? 'text-xs text-gray-500 line-through'
                          : 'text-xs text-white/70'
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
    </VesselCard>
  );
}
