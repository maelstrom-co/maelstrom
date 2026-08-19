import type { CommandProcessingState } from './command-processor.state.js';

/** Configuration for command queueing and Action execution. */
export interface CommandProcessorOptions {
  /** Enables diagnostic logging. Defaults to `false`. */
  debug?: boolean;
  /** Maximum wait for an Action runner to register before execution. */
  defaultActionWaitTimeoutMs?: number;
  /** Maximum duration allowed for an individual Action handler. */
  actionExecutionTimeoutMs?: number;
  /** Initial state override. Defaults to a fresh empty tiling state. */
  initialState?: CommandProcessingState;
}
