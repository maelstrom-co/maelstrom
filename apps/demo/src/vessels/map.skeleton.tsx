import { VesselCard } from '../components/vessel-card';

export function MapSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="brand-3" label="Map" meta="Loading...">
      <div className="flex-1 rounded-lg overflow-hidden bg-white/5 animate-pulse flex items-center justify-center">
        <div className="h-8 w-8 rounded-full bg-white/5" />
      </div>
    </VesselCard>
  );
}
