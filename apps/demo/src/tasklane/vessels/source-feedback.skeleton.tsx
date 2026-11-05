import { TasklaneCard } from '../tasklane-card';

export function SourceFeedbackSkeleton(_props: { vesselId: string }) {
  return (
    <TasklaneCard title="Feedback" meta="Loading...">
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="tasklane-skeleton-bar h-4"
            style={{ width: `${90 - i * 10}%` }}
          />
        ))}
      </div>
    </TasklaneCard>
  );
}
