import { VesselCard } from '../components/vessel-card';

export function MapSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="violet" label="Map" meta="Loading...">
      <div className="flex-1 rounded-lg overflow-hidden bg-violet-accent/6 animate-pulse flex items-center justify-center">
        <div className="h-8 w-8 rounded-full bg-violet-accent/10" />
      </div>
    </VesselCard>
  );
}
