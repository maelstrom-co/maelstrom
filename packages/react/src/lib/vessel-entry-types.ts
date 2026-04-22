import type { ComponentType } from 'react';
import type { Vessel } from '@maelstrom-co/protocol';

import type { ActionRunner, AllVariantActionNames, ExtractActionParams } from '@maelstrom-co/client';
// VariantPropsUnion is the React-side prop-inference helper. It stays on
// protocol-old until the vessel-inference follow-up (out of scope for MAE-138).
import type { VariantPropsUnion } from '@maelstrom-co/protocol-old';

/** Typed props delivered to a vessel component */
export interface TypedVesselProps<V extends Vessel> {
  instanceId: string;
  variantProps: VariantPropsUnion<V>;
  executeAction: <N extends AllVariantActionNames<V>>(
    ...args: ExtractActionParams<V, N> extends undefined
      ? [name: N]
      : [name: N, params: ExtractActionParams<V, N>]
  ) => void;
}

/** Eager vessel entry — component is already loaded */
export interface VesselEntry<V extends Vessel> {
  vessel: V;
  component: ComponentType<TypedVesselProps<V>>;
}

/** Lazy loader function for a vessel component */
export type LazyVesselComponentLoader<V extends Vessel> = () => Promise<{
  default: ComponentType<TypedVesselProps<V>>;
}>;

/** Lazy vessel entry — component is loaded on demand */
export interface LazyVesselEntry<V extends Vessel> {
  vessel: V;
  component: LazyVesselComponentLoader<V>;
  loadingComponent: ComponentType<{ vesselId: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyVesselEntry<T extends Vessel = any> = VesselEntry<T> | LazyVesselEntry<T>;

/** Extract vessel IDs from a tuple of vessel entries */
export type VesselIds<TVessels extends readonly AnyVesselEntry[]> =
  TVessels[number]['vessel']['id'];

/**
 * Extract the Vessel definition type from a tuple of entries by its literal ID.
 *
 * @example
 * type CalendarVessel = ExtractVesselByIdFromEntries<typeof entries, 'calendar'>;
 */
export type ExtractVesselByIdFromEntries<
  T extends readonly AnyVesselEntry[],
  Id extends VesselIds<T>,
> = Extract<T[number], { vessel: { id: Id } }>['vessel'];

/**
 * Pre-computed lookup mapping vessel IDs to their ActionRunner types.
 * Avoids deep generic resolution at call sites (helps tsc --build inference).
 */
export type ActionRunnerLookup<T extends readonly AnyVesselEntry[]> = {
  [E in T[number] as E['vessel']['id']]: ActionRunner<E['vessel']>;
};
