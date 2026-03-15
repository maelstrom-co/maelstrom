import type { ChartPosition, ChartSize } from '@maelstrom/protocol';

/** Runtime instance of a Vessel */
export interface VesselInstance {
  /** Unique instance ID */
  instanceId: string;
  /** ID of the Vessel type */
  vesselId: string;
  /** Current variant name */
  variant: string;
  /** Current position on the Chart */
  position: ChartPosition;
  /** Current size (>= variant's minSize) */
  size: ChartSize;
}

export function isPromise(obj: unknown): obj is Promise<unknown> {
  return (
    !!obj &&
    (typeof obj === 'object' || typeof obj === 'function') &&
    'then' in obj &&
    typeof (obj as Record<string, unknown>).then === 'function'
  );
