import { VesselCard } from '../components/vessel-card';

export function TasksSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="violet" label="Tasks" meta="Loading...">
      <div className="h-1 w-full rounded-full bg-violet-accent/8 mb-3" />
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="w-4 h-4 rounded bg-violet-accent/10 shrink-0" />
            <div
              className="h-4 bg-violet-accent/10 rounded"
              style={{ width: `${60 + i * 10}%` }}
            />
          </div>
        ))}
      </div>
    </VesselCard>
  );
}
