import type { LayoutMode } from '@maelstrom-co/protocol-old';

import type {
  MessageProcessingState,
  MessageProcessingStatus,
} from './types.js';

export type { MessageProcessingState, MessageProcessingStatus };

export function createInitialMessageProcessingState(
  layoutMode: LayoutMode = 'tiling',
): MessageProcessingState {
  return {
    status: 'idle' as MessageProcessingStatus,
    instances: new Map(),
    layout: null,
    layoutMode,
    lastError: null,
  };
}
