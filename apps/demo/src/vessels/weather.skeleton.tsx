import type { VesselLoadingSkeletonProps } from '@maelstrom-co/react';

/**
 * Custom loading skeleton for the Weather vessel.
 * Displays a pulsing placeholder that matches the weather component's layout.
 */
export function WeatherSkeleton(_props: VesselLoadingSkeletonProps) {
  return (
    <div className="vessel-card h-full flex flex-col animate-pulse">
      <div className="vessel-card-header flex justify-between items-center">
        <div className="h-4 bg-gray-700 rounded w-24" />
        <div className="flex gap-1">
          <div className="h-6 w-14 bg-gray-700 rounded" />
          <div className="h-6 w-12 bg-gray-700 rounded" />
        </div>
      </div>
      <div className="vessel-card-body flex-1 flex flex-col items-center justify-center gap-3">
        <div className="h-12 w-12 bg-gray-700 rounded-full" />
        <div className="h-8 w-20 bg-gray-700 rounded" />
        <div className="h-4 w-16 bg-gray-700 rounded" />
        <div className="flex gap-4 mt-2">
          <div className="h-4 w-12 bg-gray-700 rounded" />
          <div className="h-4 w-16 bg-gray-700 rounded" />
        </div>
      </div>
    </div>
  );
}
