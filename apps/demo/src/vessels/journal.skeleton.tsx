import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';

export function JournalSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard
      accent={VESSEL_ACCENTS.journal}
      label="Journal"
      meta="Loading..."
    >
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="py-2.5 border-b border-white/[0.06]">
            <div className="h-4 w-32 bg-white/5 rounded" />
            <div className="h-3 w-20 bg-white/5 rounded mt-1.5" />
            <div className="h-3 w-full bg-white/5 rounded mt-1.5" />
          </div>
        ))}
      </div>
    </VesselCard>
  );
}
