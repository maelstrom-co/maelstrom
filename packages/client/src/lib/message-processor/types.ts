import type { GridLayout, LayoutMode, TilingLayout } from '@maelstrom-co/protocol';

import type { VesselInstance } from '../types.js';

/**
 * Status of the message processing state machine.
 */
export type MessageProcessingStatus = 'idle' | 'processing' | 'error';

/**
 * State for message processing.
 * Internal fields (messageQueue, currentMessage) are private to MessageProcessor.
 */
export type MessageProcessingState = {
  status: MessageProcessingStatus;
  instances: Map<string, VesselInstance>;
  layout: GridLayout | TilingLayout | null;
  layoutMode: LayoutMode;
  lastError: Error | null;
};
