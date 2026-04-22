import type { Vessel } from '@maelstrom-co/protocol';

/**
 * Event fired when a vessel is registered.
 */
export interface VesselRegisteredEvent {
  type: 'vessel_registered';
  vessel: Vessel;
  timestamp: number;
}

/**
 * Event fired when a vessel is unregistered.
 */
export interface VesselUnregisteredEvent {
  type: 'vessel_unregistered';
  vesselId: string;
  vessel: Vessel;
  timestamp: number;
}

/**
 * Union type of all vessel manager listener events.
 */
export type VesselManagerListenerEvent =
  | VesselRegisteredEvent
  | VesselUnregisteredEvent;

/**
 * Type for event listener callbacks.
 * Listeners can be sync or async, but errors are caught and logged.
 */
export type VesselManagerListenerCallback<
  E extends VesselManagerListenerEvent = VesselManagerListenerEvent,
> = (event: E) => void | Promise<void>;

/**
 * Map of event types to their specific callback types.
 */
export interface VesselManagerListenerMap {
  vessel_registered: VesselManagerListenerCallback<VesselRegisteredEvent>;
  vessel_unregistered: VesselManagerListenerCallback<VesselUnregisteredEvent>;
}

/**
 * Event type names.
 */
export type VesselManagerListenerEventType = keyof VesselManagerListenerMap;
