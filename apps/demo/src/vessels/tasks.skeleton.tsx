import { VesselCard } from '../components/vessel-card';

export function TasksSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="amber" label="Tasks" meta="Loading...">
      <div className="h-1 w-full rounded-full bg-white/5 mb-3" />
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="w-4 h-4 rounded bg-white/5 shrink-0" />
            <div
              className="h-4 bg-white/5 rounded"
              style={{ width: `${60 + i * 10}%` }}
            />
          </div>
        ))}
      </div>
    </VesselCard>
  );
}
