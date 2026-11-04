import { VesselCard } from '../../components/vessel-card';

export function TeamLoadSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="brand" label="Team load" meta="Loading...">
      <div className="flex-1 space-y-2 animate-pulse">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-6 bg-white/5 rounded" />
        ))}
      </div>
    </VesselCard>
  );
}
