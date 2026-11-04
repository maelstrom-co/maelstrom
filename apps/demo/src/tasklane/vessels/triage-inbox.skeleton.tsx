import { TasklaneCard } from '../tasklane-card';

export function TriageInboxSkeleton(_props: { vesselId: string }) {
  return (
    <TasklaneCard title="Triage inbox" meta="Loading...">
      <div className="flex-1 space-y-2 animate-pulse">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="tasklane-skeleton-bar h-6" />
        ))}
      </div>
    </TasklaneCard>
  );
}
