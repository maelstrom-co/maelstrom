import type { MessageProcessingState } from './types.js';

/**
 * Configuration options for the MessageProcessor.
 */
export interface MessageProcessorOptions {
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Max wait time for instance readiness before skipping actions in ms (default: 500) */
  defaultActionWaitTimeoutMs?: number;
  /** Initial state override */
  initialState?: MessageProcessingState;
}
