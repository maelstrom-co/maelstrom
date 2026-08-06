import type {
  ActionNames,
  ActionParams,
  ActionRunner,
  VariantNames,
} from '@maelstrom-co/client';
import type {
  ActionName,
  InstanceId,
  VariantName,
  VesselDefinition,
  VesselId,
  VesselVariantDefinition,
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

/**
 * A vessel definition safe to hand to `m.updateVessel()` or `handle.update()`
 * to republish `V`'s definition without remounting its component.
 *
 * `props` is the crash surface: the rendered component and the hook that
 * feeds it read `props` straight off the store and hand it to the mounted
 * component, so a shape drift throws at render time instead of failing to
 * compile. `actions`, `enum` values, `description`, and `minSize` stay
 * free-form — pinning them too would break the documented republish use
 * case of rebuilding an action's `enum` from live data.
 *
 * `variants` is a `Record<string, ...>`, not a per-key mapped type over
 * `VariantNames<V>`, because `Object.fromEntries` — the documented rebuild
 * idiom — returns a plain index-signature type with no named keys at all.
 * No object type with required named properties can ever accept that
 * return value, regardless of how loosely those properties are typed, so
 * the target has to be an index signature too. The cost: props are checked
 * against the union of every registered variant's props, not the specific
 * variant named at that key, so a value shaped like variant B's props
 * passes at variant A's key. What this still catches is the actual crash —
 * a shape that matches none of the vessel's registered variants.
 */
export type RepublishableVessel<V extends VesselDefinition> =
  VesselDefinition & {
    id: V['id'];
    variants: Record<
      string,
      VesselVariantDefinition & {
        props: V['variants'][VariantNames<V>]['props'];
      }
    >;
  };

/**
 * Payload type for `m.updateVessel({ id, ... })` — `Id` must be one of the
 * vessel IDs declared in `createMaelstrom({ vessels })`, so a typo'd or
 * runtime-only id fails to compile instead of silently skipping the
 * `RepublishableVessel` shape check.
 *
 * `T` only knows the vessels declared in `createMaelstrom({ vessels })` —
 * `registerVessel()` adds ids at runtime that never appear in `T`, so
 * `m.updateVessel()` cannot name them. Republish a runtime-registered
 * vessel through `handle.update()` on the handle `registerVessel()`
 * returns instead — it is typed exactly to that call's inferred vessel
 * definition, with no id lookup needed.
 */
export type UpdateVesselPayload<
  T extends readonly AnyVesselEntry[],
  Id extends VesselIds<T>,
> = RepublishableVessel<ExtractVesselByIdFromEntries<T, Id>> & { id: Id };

/**
 * Discriminates the recoverable ways `m.updateVessel()` / `handle.update()`
 * can refuse a republish. See {@link UpdateVesselConflict} for the payload
 * each code carries.
 */
export type UpdateVesselConflictCode =
  | 'variant_dropped'
  | 'action_dropped'
  | 'batch_in_flight';

/**
 * The recoverable reason a republish did not commit — returned as data by
 * `m.updateVessel()` / `handle.update()`, never thrown.
 *
 * `'variant_dropped'` and `'action_dropped'` are ordinary, user-triggerable
 * states, not programmer mistakes — for example a `detail` variant that
 * only exists while its record does, and the user just deleted that
 * record. `'batch_in_flight'` means a command batch was already queued or
 * executing when the republish was attempted: CommandProcessor applies
 * `set_layout` / `execute_actions` through an async queue, so the instance
 * snapshot a conflict scan would read from is not yet trustworthy — that
 * in-flight batch could still land an instance on a variant the republish
 * is about to drop.
 *
 * Branch on `code`, not on `message` text, which this package is free to
 * reword.
 */
export type UpdateVesselConflict =
  | {
      code: 'variant_dropped';
      vesselId: VesselId;
      instanceId: InstanceId;
      variant: VariantName;
      message: string;
    }
  | {
      code: 'action_dropped';
      vesselId: VesselId;
      instanceId: InstanceId;
      variant: VariantName;
      missingActionNames: readonly ActionName[];
      message: string;
    }
  | {
      code: 'batch_in_flight';
      vesselId: VesselId;
      message: string;
    };

/**
 * Return type of `m.updateVessel()` and `handle.update()`.
 *
 * `ok: false` is an ordinary, user-triggerable outcome, not a bug report —
 * check `result.conflict.code` and decide whether to retry, skip the
 * republish, or surface a message.
 */
export type UpdateVesselResult =
  | { ok: true }
  | { ok: false; conflict: UpdateVesselConflict };
