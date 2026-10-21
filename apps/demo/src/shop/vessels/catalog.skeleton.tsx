import { VesselCard } from '../../components/vessel-card';
import { VESSEL_ACCENTS } from '../../lib/design-tokens';

export function CatalogSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard
      accent={VESSEL_ACCENTS.catalog}
      label="Catalog"
      meta="Loading..."
    >
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-4 bg-white/5 rounded"
            style={{ width: `${55 + i * 10}%` }}
          />
        ))}
      </div>
    </VesselCard>
  );
}
