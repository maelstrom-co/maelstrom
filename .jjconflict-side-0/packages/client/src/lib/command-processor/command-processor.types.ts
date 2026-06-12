import type { CommandProcessingState } from './command-processor.state.js';

export interface CommandProcessorOptions {
  debug?: boolean;
  defaultActionWaitTimeoutMs?: number;
  actionExecutionTimeoutMs?: number;
  initialState?: CommandProcessingState;
}
