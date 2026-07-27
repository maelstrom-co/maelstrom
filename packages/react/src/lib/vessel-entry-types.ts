import type {
  ActionNames,
  ActionParams,
  ActionRunner,
  VariantNames,
} from '@maelstrom-co/client';
import type {
  InstanceId,
  VesselDefinition,
  VesselId,
} from '@maelstrom-co/protocol';
import type { ComponentType } from 'react';

/**
 * Discriminated union of variant prop shapes for vessel `V`.
 *
 * For each variant `K` in `V`, contributes a member
 * `{ variant: K } & V['variants'][K]['props']`. Components consume this
 * to render different content per variant while preserving literal-type
 * narrowing on the `variant` discriminant.
 *
 * @example
 * ```typescript
 * function OrdersComponent({ variantProps }: { variantProps: VariantProps<typeof ordersVessel> }) {
 *   if (variantProps.variant === 'list') {
 *     // variantProps narrowed to the 'list' variant's props
 *   }
 * }
 * ```
 */
export type VariantProps<V extends VesselDefinition> = {
  [K in VariantNames<V>]: { variant: K } & V['variants'][K]['props'];
}[VariantNames<V>];

/** Typed props delivered to a vessel component */
export interface TypedVesselProps<V extends VesselDefinition> {
  instanceId: InstanceId;
  variantProps: VariantProps<V>;
  executeAction: <N extends ActionNames<V>>(
    ...args: ActionParams<V, N> extends undefined
      ? [name: N]
      : [name: N, params: ActionParams<V, N>]
  ) => void;
}

/** Eager vessel entry — component is already loaded */
export interface VesselEntry<V extends VesselDefinition> {
  vessel: V;
  component: ComponentType<TypedVesselProps<V>>;
}

/** Lazy loader function for a vessel component */
export type LazyVesselComponentLoader<V extends VesselDefinition> =
  () => Promise<{
    default: ComponentType<TypedVesselProps<V>>;
  }>;

/** Lazy vessel entry — component is loaded on demand */
export interface LazyVesselEntry<V extends VesselDefinition> {
  vessel: V;
  component: LazyVesselComponentLoader<V>;
  loadingComponent: ComponentType<{ vesselId: VesselId }>;
}

// biome-ignore lint/suspicious/noExplicitAny: default erases T for heterogeneous entry arrays (readonly AnyVesselEntry[] holding many distinct vessel defs); `unknown` doesn't satisfy the `VesselDefinition` constraint, so downstream generics (ExtractVesselByIdFromEntries, VesselIds, ActionRunnerLookup) fail to resolve.
export type AnyVesselEntry<T extends VesselDefinition = any> =
  | VesselEntry<T>
  | LazyVesselEntry<T>;

/** Discriminant: lazy entries carry a loadingComponent, eager ones don't. */
export function isLazyEntry(
  entry: AnyVesselEntry,
  // biome-ignore lint/suspicious/noExplicitAny: same erasure as AnyVesselEntry's default above — `unknown` doesn't satisfy the VesselDefinition constraint.
): entry is LazyVesselEntry<any> {
  return 'loadingComponent' in entry;
}

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
