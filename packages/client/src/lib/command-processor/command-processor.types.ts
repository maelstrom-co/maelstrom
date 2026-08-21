import type { CommandProcessingState } from './command-processor.state.js';

/** Configuration for command queueing and Action execution. */
export interface CommandProcessorOptions {
  /** Enables diagnostic logging. Defaults to `false`. */
  debug?: boolean;
  /**
   * Wait for a missing Action runner before skipping its Actions. Defaults to
   * 500 milliseconds.
   */
  defaultActionWaitTimeoutMs?: number;
  /**
   * Maximum duration for one Action handler. Defaults to 30,000 milliseconds;
   * expiry records that Action as failed.
   */
  actionExecutionTimeoutMs?: number;
  /** Initial state override. Defaults to a fresh empty tiling state. */
  initialState?: CommandProcessingState;
}
