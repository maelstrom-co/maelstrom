import type {
  ChartPosition,
  ChartSize,
  InstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

/** Teardown callback returned by subscriptions and registrations. */
export type Unsubscribe = () => void;

/** Runtime instance of a Vessel */
export interface VesselInstance {
  /** Unique instance ID */
  instanceId: InstanceId;
  /** ID of the Vessel type */
  vesselId: VesselId;
  /** Current variant name */
  variant: VariantName;
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
}
