import { TasklaneCard } from '../tasklane-card';

export function FlexibleTableSkeleton(_props: { vesselId: string }) {
  return (
    <TasklaneCard title="Flexible table" meta="Loading...">
      <div className="flex-1 space-y-2 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="tasklane-skeleton-bar h-6" />
        ))}
      </div>
    </TasklaneCard>
  );
}
