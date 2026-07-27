import type { VesselDefinition, VesselId } from '@maelstrom-co/protocol';
import type { ComponentType } from 'react';

import type {
  LazyVesselComponentLoader,
  LazyVesselEntry,
  TypedVesselProps,
  VesselEntry,
} from './vessel-entry-types.js';

/** Register a vessel with an eagerly-loaded component */
export function vessel<const V extends VesselDefinition>(
  definition: V,
  component: ComponentType<TypedVesselProps<V>>,
): VesselEntry<V>;

/** Register a vessel with a lazily-loaded component */
export function vessel<const V extends VesselDefinition>(
  definition: V,
  loader: LazyVesselComponentLoader<V>,
  loadingComponent: ComponentType<{ vesselId: VesselId }>,
): LazyVesselEntry<V>;

/** Implementation */
export function vessel<const V extends VesselDefinition>(
  definition: V,
  componentOrLoader:
    | ComponentType<TypedVesselProps<V>>
    | LazyVesselComponentLoader<V>,
  loadingComponent?: ComponentType<{ vesselId: VesselId }>,
): VesselEntry<V> | LazyVesselEntry<V> {
  if (loadingComponent) {
    return {
      vessel: definition,
      component: componentOrLoader as LazyVesselComponentLoader<V>,
      loadingComponent,
    };
  }
  return {
    vessel: definition,
    component: componentOrLoader as ComponentType<TypedVesselProps<V>>,
  };
}
