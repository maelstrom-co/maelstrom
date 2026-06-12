import type { ComponentType } from 'react';
import type { VesselDefinition } from '@maelstrom-co/protocol';

import type {
  ActionRunnerLookup,
  AnyVesselEntry,
  ExtractVesselByIdFromEntries,
  TypedVesselProps,
  VesselIds,
} from './vessel-entry-types.js';
import type { DynamicVesselHandle, UntypedVesselProps } from './dynamic-vessel-types.js';
import type { MaelstromProviderProps } from './provider.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import type { ChartProps } from './chart/chart.js';
import type { ExtensionOutput, MaelstromExtension } from './extension-types.js';

/**
 * Reserved keys on the core instance shape. Extensions are forbidden from
 * defining keys with these names so `.with()` cannot silently overwrite
 * `Provider`, `Chart`, the hook surface, etc.
 */
export type ReservedInstanceKeys =
  | 'vessels'
  | 'Provider'
  | 'Chart'
  | 'useMaelstrom'
  | 'useVessel'
  | 'useActions'
  | 'useInstance'
  | 'registerVessel'
  | 'with';

/**
 * Branded compile-time guard: when an extension's return type contains any
 * `ReservedInstanceKeys`, the `with()` argument type narrows to this error
 * literal so the call no longer accepts the offending extension function.
 */
type ExtensionRejectsReserved<NewExt extends ExtensionOutput> =
  Extract<keyof NewExt, ReservedInstanceKeys> extends never
    ? MaelstromExtension<NewExt>
    : `Error: extension cannot define reserved Maelstrom key '${Extract<keyof NewExt & ReservedInstanceKeys, string>}'`;

/**
 * Core Maelstrom instance fields. Generic over `Ext` so the recursive
 * `with()` return type can carry accumulated extensions; the public type
 * is `MaelstromInstance<T, Ext> = MaelstromInstanceCore<T, Ext> & Ext`,
 * so extension fields are structurally part of the instance — no
 * intersection casts needed at the merge site.
 */
export interface MaelstromInstanceCore<
  T extends readonly AnyVesselEntry[],
  Ext extends ExtensionOutput = {},
> {
  vessels: T;
  Provider: ComponentType<MaelstromProviderProps>;
  Chart: ComponentType<ChartProps>;
  /**
   * Returns reactive Maelstrom state. Call with no args for the full state,
   * or pass a selector to subscribe to a slice and avoid re-renders when
   * unrelated fields change. Derived objects are shallow-compared.
   *
   * @example
   * const { processIntent, isProcessing } = m.useMaelstrom();
   *
   * @example
   * const isProcessing = m.useMaelstrom((s) => s.isProcessing);
   */
  useMaelstrom: {
    <TSelected>(selector: (state: MaelstromState) => TSelected): TSelected;
    (): MaelstromState;
  };

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
   *   showWeek: () => ok(undefined),
   * });
   */
  useActions: <Id extends VesselIds<T>>(
    vesselId: Id,
    instanceId: string,
    runner: ActionRunnerLookup<T>[Id],
  ) => void;

  /**
   * Untyped escape hatch — returns props for any instance regardless of vessel type.
   * Works for both statically and dynamically registered vessels.
   * variantProps is `Record<string, unknown>` and action names are `string`.
   *
   * @example
   * const props = m.useInstance(instanceId);
   * if (!props) return null;
   * // props.vesselId tells you which vessel this is
   */
  useInstance: (instanceId: string) => UntypedVesselProps | null;

  /**
   * Dynamically register a vessel at runtime. Returns a typed handle with
   * scoped `useVessel`, `useActions`, and `unregister()`.
   * Throws if the vessel fails validation.
   *
   * Must be called while a Provider is mounted. The vessel becomes available
   * for subsequent engine decisions (processIntent calls).
   *
   * @example
   * const handle = m.registerVessel(widgetEntry);
   * // In component:
   * const props = handle.useVessel(instanceId);
   * // Cleanup:
   * handle.unregister();
   */
  registerVessel: <V extends VesselDefinition>(
    entry: AnyVesselEntry<V>,
  ) => DynamicVesselHandle<V>;

  /**
   * Apply an extension to the instance, returning a new instance with the
   * extension's fields merged onto the public surface.
   *
   * The returned instance is fresh — calling `.with()` does not mutate the
   * receiver, so branched chains like
   * `const a = m.with(extA); const b = m.with(extB);` produce independent
   * instances that do not share each other's extension fields.
   *
   * Reserved keys (`vessels`, `Provider`, `Chart`, the hook surface,
   * `with`) are rejected at compile time. When two extensions in the same
   * chain define the same custom key, the later wins at runtime and a
   * one-shot `console.warn` flags the collision.
   *
   * @example
   * const analytics: MaelstromExtension<{ track: (event: string) => void }> = () => ({
   *   track: (event) => console.log('[analytics]', event),
   * });
   *
   * const m = createMaelstrom({ vessels }).with(analytics);
   * m.track('app:start');
   */
  with<NewExt extends ExtensionOutput>(
    ext: ExtensionRejectsReserved<NewExt>,
  ): MaelstromInstance<T, Ext & NewExt>;
}

/** Return type of createMaelstrom() — core fields plus any applied extensions. */
export type MaelstromInstance<
  T extends readonly AnyVesselEntry[],
  Ext extends ExtensionOutput = {},
> = MaelstromInstanceCore<T, Ext> & Ext;
