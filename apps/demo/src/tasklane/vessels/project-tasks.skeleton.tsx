import { VesselCard } from '../../components/vessel-card';

export function ProjectTasksSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="amber" label="Tasks" meta="Loading...">
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-8 bg-white/5 rounded"
            style={{ marginLeft: `${(i % 2) * 16}px` }}
          />
        ))}
      </div>
    </VesselCard>
  );
}
