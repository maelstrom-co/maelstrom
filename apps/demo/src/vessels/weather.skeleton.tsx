import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';

export function WeatherSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard
      accent={VESSEL_ACCENTS.weather}
      label="Weather"
      meta="Loading..."
    >
      <div className="flex-1 flex flex-col items-center justify-center gap-3 animate-pulse">
        <div className="h-12 w-12 bg-white/5 rounded-full" />
        <div className="h-10 w-24 bg-white/5 rounded" />
        <div className="h-4 w-16 bg-white/5 rounded" />
        <div className="flex gap-4 mt-2">
          <div className="h-4 w-14 bg-white/5 rounded" />
          <div className="h-4 w-14 bg-white/5 rounded" />
        </div>
      </div>
    </VesselCard>
  );
}
