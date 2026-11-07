import type { TypedVesselProps } from '@maelstrom-co/react';

import {
  isOpenTask,
  isUrgentTask,
  type ProjectTask,
  useProjectTasksStore,
} from '../stores/project-tasks.store';
import { TasklaneCard } from '../tasklane-card';
import type { projectPulseVessel } from './project-pulse.vessel';

export default function ProjectPulseComponent(
  _props: TypedVesselProps<typeof projectPulseVessel>,
) {
  const { tasks } = useProjectTasksStore();
  const stats = pulseStats(tasks);

  return (
    <TasklaneCard title="Pulse">
      <section aria-label="Project pulse" className="flex-1 min-h-0">
        <dl className="grid h-full grid-cols-2 gap-2">
          {stats.map(({ id, label, value }) => (
            <div
              key={id}
              data-stat={id}
              className="tasklane-pulse-tile flex flex-col justify-center px-2"
            >
              <dt className="text-xs font-mono text-ink-3 truncate">{label}</dt>
              <dd className="tasklane-pulse-value leading-tight">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </TasklaneCard>
  );
}

interface PulseStat {
  readonly id: 'total' | 'urgent' | 'unowned' | 'done';
  readonly label: string;
  readonly value: string;
}

function pulseStats(tasks: readonly ProjectTask[]): PulseStat[] {
  const open = tasks.filter(isOpenTask);
  const done = tasks.length - open.length;
  const percentDone =
    tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  return [
    { id: 'total', label: 'Tasks', value: String(tasks.length) },
    {
      id: 'urgent',
      label: 'Urgent',
      value: String(open.filter(isUrgentTask).length),
    },
    {
      id: 'unowned',
      label: 'Unowned',
      value: String(open.filter((task) => task.assigneeId === null).length),
    },
    { id: 'done', label: 'Done', value: `${percentDone}%` },
  ];
}
