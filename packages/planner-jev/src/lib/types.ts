// Intermediate values passed between the Jev stages. They belong to this
// experiment and are not exported from the package.
import type { PlanningInput } from '@maelstrom-co/engine';
import type {
  ActionName,
  ActionParameter,
  InstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

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

/** A parameter whose value the request states in a form Jev could not pick; the LLM fills it. */
export interface PendingParameter {
  readonly name: string;
  readonly type: ActionParameter['type'];
  readonly description: string;
  /** Normalized enum values when the parameter declares any. */
  readonly enum?: readonly unknown[];
}

export interface PlannedAction {
  readonly instanceId: InstanceId;
  readonly action: ActionName;
  /** Values Jev bound. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Values the LLM must fill before the action can ship. */
  readonly pending: readonly PendingParameter[];
}

/** An action dropped because the request gives no value for one of its parameters. */
export interface ParameterAsk {
  readonly instanceId: InstanceId;
  readonly action: ActionName;
  readonly parameter: PendingParameter;
}

export interface JevActionPlan {
  readonly selection: JevSelection;
  /** Planned actions, in order. */
  readonly actions: readonly PlannedAction[];
  /** Values to ask the user for; their actions are not in {@link actions}. */
  readonly asks: readonly ParameterAsk[];
  readonly answers: readonly AnswerRecord[];
}
