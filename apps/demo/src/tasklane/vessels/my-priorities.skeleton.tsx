import { VesselCard } from '../../components/vessel-card';

export function MyPrioritiesSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="green" label="My priorities" meta="Loading...">
      <div className="flex-1 space-y-2 animate-pulse">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-6 bg-white/5 rounded" />
        ))}
      </div>
    </VesselCard>
  );
}
