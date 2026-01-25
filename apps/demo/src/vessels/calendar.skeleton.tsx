import type { VesselLoadingSkeletonProps } from '@maelstrom/react';

/**
 * Custom loading skeleton for the Calendar vessel.
 * Displays a pulsing placeholder that matches the calendar component's layout.
 */
export function CalendarSkeleton({ vesselName }: VesselLoadingSkeletonProps) {
  return (
    <div className="vessel-card h-full flex flex-col animate-pulse">
      <div className="vessel-card-header flex justify-between items-center">
        <div className="h-4 bg-gray-700 rounded w-20" />
        <div className="flex gap-1">
          <div className="h-6 w-12 bg-gray-700 rounded" />
          <div className="h-6 w-16 bg-gray-700 rounded" />
        </div>
      </div>
      <div className="vessel-card-body flex-1 flex flex-col gap-2">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-700 rounded" />
          ))}
        </div>
        {/* Calendar grid */}
        <div className="flex-1 grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="h-6 bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
