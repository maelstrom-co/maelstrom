import { TasklaneCard } from '../tasklane-card';

export function ProjectPulseSkeleton(_props: { vesselId: string }) {
  return (
    <TasklaneCard title="Pulse">
      <div className="flex-1 grid grid-cols-2 gap-2 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="tasklane-skeleton-bar" />
        ))}
      </div>
    </TasklaneCard>
  );
}
