import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';

// The skeleton cannot know which Variant is loading, so the region's height
// picks between the card and the compact strip.
export function WeatherSkeleton(_props: { vesselId: string }) {
  return (
    <div className="weather-skeleton h-full">
      <div className="weather-skeleton__card h-full">
        <VesselCard
          accent={VESSEL_ACCENTS.weather}
          label="Weather"
          meta="Loading..."
        >
          <div className="weather-current flex-1 flex flex-col items-center justify-center gap-3 animate-pulse motion-reduce:animate-none">
            <div className="h-12 w-12 bg-white/5 rounded-full" />
            <div className="h-10 w-24 bg-white/5 rounded" />
            <div className="weather-current__extra h-4 w-16 bg-white/5 rounded" />
            <div className="weather-current__extra flex gap-4 mt-2">
              <div className="h-4 w-14 bg-white/5 rounded" />
              <div className="h-4 w-14 bg-white/5 rounded" />
            </div>
          </div>
        </VesselCard>
      </div>
      <div className="weather-skeleton__strip weather-compact h-full">
        <span role="status" className="sr-only">
          Loading weather...
        </span>
        <div className="weather-compact__row animate-pulse motion-reduce:animate-none">
          <div className="h-4 w-4 shrink-0 bg-white/5 rounded-full" />
          <div className="h-5 w-10 shrink-0 bg-white/5 rounded" />
          <div className="h-4 w-14 shrink-0 bg-white/5 rounded" />
          <div className="h-3 w-24 min-w-0 bg-white/5 rounded" />
        </div>
      </div>
    </div>
  );
}
