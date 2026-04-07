import type { ComponentType } from 'react';
import type { Vessel } from '@maelstrom-co/protocol-old';
import type { ActionRunner } from '@maelstrom-co/client';

import type {
  AnyVesselEntry,
  ExtractVesselByIdFromEntries,
  TypedVesselProps,
  VesselIds,
} from './vessel-entry-types.js';
import type { DynamicVesselHandle, UntypedVesselProps } from './dynamic-vessel-types.js';
import type { MaelstromProviderProps } from './provider.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import type { ChartProps } from './chart/chart.js';
import type { UseVoiceOptions, UseVoiceReturn } from './voice/use-voice-types.js';
import type { VoiceOrbProps } from './voice/voice-orb.js';

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
  registerVessel: <V extends Vessel>(entry: AnyVesselEntry<V>) => DynamicVesselHandle<V>;

  /**
   * Voice hook with session ownership semantics.
   *
   * - `useVoice({ ...options })` — **owner**: creates the voice session with
   *   your configuration and callbacks. When the owner unmounts, the session is
   *   destroyed. Only one owner should exist at a time.
   * - `useVoice()` — **observer**: reads the shared session state. Actions like
   *   `start()`/`stop()` operate on the owner's session.
   * - `useVoice({})` — treated as observer (empty options = no ownership).
   *
   * `@maelstrom-co/voice-old` is loaded via dynamic import only when an owner mounts.
   *
   * @example
   * // Owner — configures session, wires callbacks
   * const voice = m.useVoice({ greeting: 'Hello!', onError: console.error });
   * // Observer — reads state, triggers actions on shared session
   * const voice = m.useVoice();
   */
  useVoice: (options?: UseVoiceOptions) => UseVoiceReturn;

  /**
   * Self-contained voice indicator button. Internally observes the shared
   * voice session and toggles listening on click. Renders null if voice
   * is not supported.
   *
   * @example
   * <m.VoiceOrb />
   * <m.VoiceOrb size={48} />
   */
  VoiceOrb: ComponentType<VoiceOrbProps>;
}
