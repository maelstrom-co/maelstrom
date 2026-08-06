import type { VesselDefinition } from '@maelstrom-co/protocol';
import type { ComponentType } from 'react';
import type { ChartProps } from './chart/chart.js';
import type {
  DynamicVesselHandle,
  UntypedVesselProps,
} from './dynamic-vessel-types.js';
import type { ExtensionOutput, MaelstromExtension } from './extension-types.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import type { MaelstromProviderProps } from './provider.js';
import type {
  ActionRunnerLookup,
  AnyVesselEntry,
  ExtractVesselByIdFromEntries,
  TypedVesselProps,
  UpdateVesselPayload,
  UpdateVesselResult,
  VesselIds,
} from './vessel-entry-types.js';

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
  | 'updateVessel'
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
  Ext extends ExtensionOutput = object,
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
   * scoped `useVessel`, `useActions`, `update()`, and `unregister()`.
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
   * Republish a registered vessel's definition — its description, variants,
   * and action parameters — without touching its component registration.
   *
   * Use this to keep the LLM-facing contract in sync with live data, e.g.
   * re-declaring an action parameter's `enum` as the underlying list changes.
   * Unlike `registerVessel`, this never re-wraps the component, so the vessel
   * does not remount and keeps any DOM/canvas state it owns.
   *
   * `updateVessel` replaces the definition wholesale — it does not merge —
   * so a rebuild that keeps only the variant or action being edited silently
   * drops every other one, and reports a conflict if any live instance's
   * current variant is missing from the rebuild. Map over every variant and
   * every action instead, as below, so nothing but the targeted parameter
   * changes.
   *
   * For a vessel id declared in `createMaelstrom({ vessels })`, every
   * variant's `props` must match the shape of some variant on that
   * vessel's factory-declared entry — the entry passed to
   * `createMaelstrom({ vessels })`, fixed at compile time — which is what
   * stops a rebuild from silently handing a mounted component a
   * `variantProps` object missing a field it destructures. That check is
   * per-vessel, not per-variant-key: it does not catch swapping two
   * variants' `props` shapes with each other. `actions`, `enum` values,
   * `description`, and `minSize` are not checked and stay free to change;
   * that is exactly the workflow the example below relies on.
   *
   * For a vessel id registered only at runtime via `registerVessel()`, `Id`
   * is outside `VesselIds<T>` and this function cannot name it — call
   * `update()` on the handle `registerVessel()` returns instead. That
   * handle is typed to its own inferred vessel definition, so it gets the
   * same `props`-shape check as above, just checked against the handle's
   * `V` rather than a factory-declared entry.
   *
   * The republish is lazy: it updates the local store immediately, but
   * nothing schedules a fresh engine request on its own. The engine keeps
   * working from the previous definition until some other event sends a
   * request — an intent, an action, a resize. If the change raises a
   * variant's `minSize`, live tiles on that variant also keep their old
   * rect until then.
   *
   * @returns `{ ok: true }` once the definition is committed. `{ ok: false,
   * conflict }` when the republish was refused for a recoverable,
   * user-triggerable reason — not a bug — and the previous definition
   * stays in force: `conflict.code === 'variant_dropped'` means a live
   * instance's current variant is absent from the new definition;
   * `'action_dropped'` means the new definition drops an action the
   * current definition declares on that instance's variant (for example a
   * `detail` variant that only exists while its record does, and the user
   * just deleted that record); `'batch_in_flight'` means a command batch
   * was already queued or executing, so the instance snapshot this check
   * would scan cannot be trusted yet — retry once it settles. The
   * variant/action scan covers every instance in the command-processor
   * store, including instances not currently rendered as a tile. Branch on
   * `conflict.code`, not on `conflict.message` text, which this package is
   * free to reword.
   *
   * @throws `Error` if no Provider is mounted, if the vessel id is not
   * already registered, or if the definition fails validation — those are
   * caller mistakes, not recoverable states.
   *
   * @example
   * const titles = ['Sprint kickoff', 'Architecture review'];
   * const result = m.updateVessel({
   *   ...journalVessel,
   *   variants: Object.fromEntries(
   *     Object.entries(journalVessel.variants).map(([variantName, variant]) => [
   *       variantName,
   *       {
   *         ...variant,
   *         actions: variant.actions.map((action) =>
   *           action.name === 'openEntry' && action.parameters
   *             ? {
   *                 ...action,
   *                 parameters: action.parameters.map((parameter) =>
   *                   parameter.name === 'title'
   *                     ? { ...parameter, enum: titles }
   *                     : parameter,
   *                 ),
   *               }
   *             : action,
   *         ),
   *       },
   *     ]),
   *   ),
   * });
   * if (!result.ok) {
   *   switch (result.conflict.code) {
   *     case 'variant_dropped':
   *     case 'action_dropped':
   *       // A live instance would be stranded by this republish — skip it,
   *       // or surface a message and retry once the record exists again.
   *       break;
   *     case 'batch_in_flight':
   *       // A batch was already in flight — retry on the next render.
   *       break;
   *   }
   * }
   */
  updateVessel: <Id extends VesselIds<T>>(
    vessel: UpdateVesselPayload<T, Id>,
  ) => UpdateVesselResult;

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
  Ext extends ExtensionOutput = object,
> = MaelstromInstanceCore<T, Ext> & Ext;
