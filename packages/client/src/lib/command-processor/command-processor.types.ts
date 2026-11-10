import type { VesselDefinition, VesselId } from '@maelstrom-co/protocol';

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
  /**
   * Looks up a registered Vessel definition. With it, each Action of an
   * `execute_actions` command resolves against its Instance's Variant at that
   * Action's turn, and its `transitionsTo` applies after the handler succeeds.
   * An Action declared `effect: 'none'` with no handler applies its transition
   * on its own, as long as the Instance has a registered action runner. Any
   * other Action without a handler is skipped and changes no Variant. Without
   * it, handlers are looked up by Action name alone and no Variant changes.
   */
  resolveVessel?: (vesselId: VesselId) => VesselDefinition | undefined;
}
