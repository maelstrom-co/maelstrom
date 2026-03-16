import type { VesselLoadingSkeletonProps } from '@maelstrom-co/react';

const DAY_PLACEHOLDERS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'];
const CELL_PLACEHOLDERS = Array.from({ length: 35 }, (_, i) => `c${i}`);

/**
 * Custom loading skeleton for the Calendar vessel.
 * Displays a pulsing placeholder that matches the calendar component's layout.
 */
export function CalendarSkeleton(_props: VesselLoadingSkeletonProps) {
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
        <div className="grid grid-cols-7 gap-1">
          {DAY_PLACEHOLDERS.map((id) => (
            <div key={id} className="h-4 bg-gray-700 rounded" />
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 gap-1">
          {CELL_PLACEHOLDERS.map((id) => (
            <div key={id} className="h-6 bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
