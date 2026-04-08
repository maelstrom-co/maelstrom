import type { VesselLoadingSkeletonProps } from '@maelstrom-co/react-old';
import { VesselCard } from '../components/vessel-card';

export function JournalSkeleton(_props: VesselLoadingSkeletonProps) {
  return (
    <VesselCard accent="seafoam" label="Journal" meta="Loading...">
      <div className="flex-1 space-y-3 animate-pulse">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="py-2.5 border-b border-seafoam-accent/6">
            <div className="h-4 w-32 bg-seafoam-accent/10 rounded" />
            <div className="h-3 w-20 bg-seafoam-accent/10 rounded mt-1.5" />
            <div className="h-3 w-full bg-seafoam-accent/10 rounded mt-1.5" />
          </div>
        ))}
      </div>
    </VesselCard>
  );
}
