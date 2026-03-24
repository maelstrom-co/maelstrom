import type { ComponentType } from 'react';
import type { Vessel } from '@maelstrom-co/protocol-old';

import type { ActionNames, VariantPropsUnion } from '@maelstrom-co/protocol-old';

/** Typed props delivered to a vessel component */
export interface TypedVesselProps<V extends Vessel> {
  instanceId: string;
  variantProps: VariantPropsUnion<V>;
  executeAction: (
    name: ActionNames<V>,
    params?: Record<string, unknown>,
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
