import type { UpdateReason } from '@maelstrom-co/protocol';

/**
 * Event fired when pending updates are flushed.
 */
export interface UpdatesFlushedEvent {
  type: 'updates_flushed';
  updates: UpdateReason[];
  rawCount: number;
  timestamp: number;
}

/**
 * Union type of all update coordinator listener events.
 */
export type UpdateCoordinatorListenerEvent = UpdatesFlushedEvent;

/**
 * Type for event listener callbacks.
 */
export type UpdateCoordinatorListenerCallback<
  E extends UpdateCoordinatorListenerEvent = UpdateCoordinatorListenerEvent,
> = (event: E) => void | Promise<void>;

/**
 * Map of event types to their specific callback types.
 */
export interface UpdateCoordinatorListenerMap {
  updates_flushed: UpdateCoordinatorListenerCallback<UpdatesFlushedEvent>;
}

/**
 * Event type names.
 */
export type UpdateCoordinatorListenerEventType =
  keyof UpdateCoordinatorListenerMap;
