import type { ComponentType } from 'react';
import type { ActionRunner } from '@maelstrom-co/client';

import type {
  AnyVesselEntry,
  ExtractVesselByIdFromEntries,
  TypedVesselProps,
  VesselIds,
} from './vessel-entry-types.js';
import type { MaelstromProviderProps } from './provider.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import type { ChartProps } from './chart/chart.js';

/** Return type of createMaelstrom() */
export interface MaelstromInstance<T extends readonly AnyVesselEntry[]> {
  vessels: T;
  Provider: ComponentType<MaelstromProviderProps>;
  Chart: ComponentType<ChartProps>;
  useMaelstrom: () => MaelstromState;

  /**
   * Returns typed vessel props for the given vessel ID and instance ID.
   * Returns null when the instance doesn't exist or belongs to a different vessel type.
   *
   * variantProps is a discriminated union narrowable via `variantProps.variant`.
   * executeAction triggers an optimistic local variant transition (if transitionsTo is set),
   * then dispatches to registered action runners via CommandProcessor.
   *
   * @example
   * const props = m.useVessel('calendar', instanceId);
   * if (!props) return null;
   * // props.variantProps.variant === 'month' | 'week'
   */
  useVessel: <Id extends VesselIds<T>>(
    vesselId: Id,
    instanceId: string,
  ) => TypedVesselProps<ExtractVesselByIdFromEntries<T, Id>> | null;

  /**
   * Registers side-effect handlers for actions dispatched to an instance (both engine-initiated and user-initiated via executeAction).
   * Automatically unregisters on component unmount.
   *
   * Pass a stable runner reference (defined outside the component or wrapped in useMemo)
   * to prevent unnecessary re-registrations on each render.
   *
   * @example
   * m.useActions('calendar', instanceId, {
   *   showWeek: () => Success(),
   * });
   */
  useActions: <Id extends VesselIds<T>>(
    vesselId: Id,
    instanceId: string,
    runner: ActionRunner<ExtractVesselByIdFromEntries<T, Id>>,
  ) => void;
}
