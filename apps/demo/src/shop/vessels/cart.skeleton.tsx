import { VesselCard } from '../../components/vessel-card';
import { VESSEL_ACCENTS } from '../../lib/design-tokens';

export function CartSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard
      accent={VESSEL_ACCENTS.cart}
      label="Your basket"
      meta="Just a moment…"
    >
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-4 bg-[var(--shop-chip-bg)] rounded"
            style={{ width: `${55 + i * 10}%` }}
          />
        ))}
      </div>
    </VesselCard>
  );
}
