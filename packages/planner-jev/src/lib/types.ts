// Intermediate values passed between the Jev stages. They belong to this
// experiment and are not exported from the package.
import type { PlanningInput } from '@maelstrom-co/engine';
import type { InstanceId, VariantName, VesselId } from '@maelstrom-co/protocol';

import type { StageName } from './defer.js';

/** `keep` makes the instance visible, `hide` retains it hidden. */
export type SelectionDecision = 'keep' | 'hide' | 'delete' | 'create';

export interface SelectedInstance {
  readonly instanceId: InstanceId;
  readonly vesselId: VesselId;
  /** The current variant, or the starting variant of a created instance. */
  readonly variant: VariantName;
  readonly visible: boolean;
  readonly fresh: boolean;
  readonly decision: SelectionDecision;
}

export interface AnswerRecord {
  readonly stage: StageName;
  readonly question: string;
  readonly choice: string;
  readonly confidence: number;
}

export interface JevSelection {
  readonly input: PlanningInput;
  /** Every existing instance (deleted ones included) plus the created ones. */
  readonly instances: readonly SelectedInstance[];
  readonly answers: readonly AnswerRecord[];
}
