import type { VesselLoadingSkeletonProps } from '@maelstrom-co/react-old';
import { VesselCard } from '../components/vessel-card';

export function CalendarSkeleton(_props: VesselLoadingSkeletonProps) {
  return (
    <VesselCard accent="blue" label="Calendar" meta="Loading...">
      <div className="flex-1 flex flex-col gap-2 animate-pulse">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="h-4 bg-blue-accent/10 rounded" />
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="h-6 bg-blue-accent/10 rounded" />
          ))}
        </div>
      </div>
    </VesselCard>
  );
}
