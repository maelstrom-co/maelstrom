import type { ActionName, InstanceId, MessageId } from '@maelstrom-co/protocol';
import type { CommandBatchResult } from '../command-processor/command-batch-result.js';
import type { UIStructuralSnapshot } from '../voice-session/ui-structural-snapshot.js';

/** Evidence from one response's layout-and-Actions batch, before later planning. */
export interface ApplicationSettlement {
  /** Request that produced the applied response. */
  readonly requestId: MessageId;
  /** Canonical batch outcome; partial, skipped, and disposed work is unknown. */
  readonly result: CommandBatchResult;
  /** Observed Action outcomes; incomplete execution can produce a partial list. */
  readonly actions: readonly ApplicationActionOutcome[];
  /** Client-owned structural snapshot captured after the batch settles. */
  readonly chart: UIStructuralSnapshot;
}

/** Identity and success evidence for an executed or skipped Action. */
export interface ApplicationActionOutcome {
  /** Instance targeted by the Action. */
  readonly instanceId: InstanceId;
  /** Declared Action name. */
  readonly action: ActionName;
  /** True only when the Action ran and returned success. */
  readonly succeeded: boolean;
}
