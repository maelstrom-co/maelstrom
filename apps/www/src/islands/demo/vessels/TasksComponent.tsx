import { ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useState } from 'react';

import { m } from '../maelstrom';
import type { tasksVessel } from './tasks.vessel';
import VesselCard from './VesselCard';

const TASKS = [
  { title: 'Ship v0.1', done: false },
  { title: 'Setup CI', done: true },
];

export default function TasksComponent({
  instanceId,
}: TypedVesselProps<typeof tasksVessel>) {
  const [extraTasks, setExtraTasks] = useState<string[]>([]);

  m.useActions('tasks', instanceId, {
    addTask: async ({ title }) => {
      setExtraTasks((prev) => [...prev, title]);
      return ok(undefined);
    },
  });

  const allTasks = [
    ...TASKS,
    ...extraTasks.map((t) => ({ title: t, done: false })),
  ];
  const doneCount = allTasks.filter((t) => t.done).length;
  const progress =
    allTasks.length > 0 ? (doneCount / allTasks.length) * 100 : 0;

  return (
    <VesselCard
      accent="#6b00ff"
      label="Tasks"
      meta={`${doneCount}/${allTasks.length}`}
    >
      {/* Progress bar */}
      <div
        className="h-1 w-full rounded-full mb-3"
        style={{ background: 'rgba(107, 0, 255, 0.08)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            background:
              'linear-gradient(90deg, rgba(107, 0, 255, 0.4), rgba(107, 0, 255, 0.6))',
            boxShadow: '0 0 8px rgba(107, 0, 255, 0.3)',
          }}
        />
      </div>

      <div className="space-y-2 flex-1">
        {TASKS.map((task, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div
              className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center"
              style={{
                border: `1.5px solid ${task.done ? 'rgba(107, 0, 255, 0.5)' : 'rgba(107, 0, 255, 0.25)'}`,
                background: task.done
                  ? 'rgba(107, 0, 255, 0.15)'
                  : 'transparent',
              }}
            >
              {task.done && (
                <svg
                  width="8"
                  height="8"
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
              )}
            </div>
            <span
              className={`text-[11px] truncate ${task.done ? 'text-text-muted/50 line-through' : 'text-text/80'}`}
            >
              {task.title}
            </span>
          </div>
        ))}
        {extraTasks.map((task) => (
          <div key={task} className="flex items-center gap-2.5 animate-fade-in">
            <div
              className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center"
              style={{ border: '1.5px solid rgba(107, 0, 255, 0.25)' }}
            >
              <div className="w-1 h-1 rounded-full bg-violet/40" />
            </div>
            <span className="text-[11px] text-text/80 truncate">{task}</span>
          </div>
        ))}
      </div>
    </VesselCard>
  );
}
