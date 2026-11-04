import { TasklaneCard } from '../tasklane-card';

export function ProjectTasksSkeleton(_props: { vesselId: string }) {
  return (
    <TasklaneCard title="Tasks" meta="Loading...">
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="tasklane-skeleton-bar h-8"
            style={{ marginLeft: `${(i % 2) * 16}px` }}
          />
        ))}
      </div>
    </TasklaneCard>
  );
}
