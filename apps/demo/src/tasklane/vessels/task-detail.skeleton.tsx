import { TasklaneCard } from '../tasklane-card';

export function TaskDetailSkeleton(_props: { vesselId: string }) {
  return (
    <TasklaneCard title="Task" meta="Loading...">
      <div className="flex-1 space-y-3 animate-pulse">
        <div className="tasklane-skeleton-bar h-6 w-2/3" />
        <div className="tasklane-skeleton-bar h-16" />
        <div className="tasklane-skeleton-bar h-10" />
      </div>
    </TasklaneCard>
  );
}
