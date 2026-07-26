import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';

export function MapSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent={VESSEL_ACCENTS.map} label="Map" meta="Loading...">
      <div className="flex-1 rounded-lg overflow-hidden bg-white/5 animate-pulse flex items-center justify-center">
        <div className="h-8 w-8 rounded-full bg-white/5" />
      </div>
    </VesselCard>
  );
}
