import { VesselCard } from '../../components/vessel-card';

export function SourceFeedbackSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="brand-2" label="Feedback" meta="Loading...">
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="h-4 bg-white/5 rounded"
            style={{ width: `${90 - i * 10}%` }}
          />
        ))}
      </div>
    </VesselCard>
  );
}
