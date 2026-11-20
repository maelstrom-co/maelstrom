import type {
  ActionName,
  ChartRequest,
  InstanceId,
  MessageId,
} from '@maelstrom-co/protocol';

import type { CommandBatchResult } from '../command-processor/command-batch-result.js';
import type { UIStructuralSnapshot } from '../voice-session/ui-structural-snapshot.js';

/** Evidence from an admitted {@link EngineConnector.process} response's batch, before later planning. */
export interface ApplicationSettlement {
  /** Request that produced the applied response. */
  readonly requestId: MessageId;
  /** Canonical batch outcome; partial, skipped, and disposed work is unknown. */
  readonly result: CommandBatchResult;
  /** Observed Action outcomes in Execution Plan order; incomplete execution can produce a partial list. */
  readonly actions: readonly ApplicationActionOutcome[];
  /** Client-owned structural snapshot captured after the batch settles. */
  readonly chart: UIStructuralSnapshot;
  /**
   * Full client snapshot at the same settlement boundary, including retained
   * Instances and Vessel definitions. Its mode follows the observed Layout,
   * not a pending mode preference. Update reasons are empty and remain pending
   * for the next planning request. Required by native agent acknowledgment.
   */
  readonly chartRequest?: ChartRequest;
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
