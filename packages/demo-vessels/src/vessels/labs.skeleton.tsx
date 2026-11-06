import { VesselCard } from '../components/vessel-card';

export function LabsSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="brand-3" label="Labs" meta="Demo only">
      <p role="status" className="text-sm text-ink-3">
        Loading marker selection…
      </p>
    </VesselCard>
  );
}
