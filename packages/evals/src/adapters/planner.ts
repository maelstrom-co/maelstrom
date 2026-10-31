import type { RegisteredArm } from '../core/arms.js';
import {
  type EvalOptions,
  plannerTurnAdapter,
  type RunRecord,
} from '../core/run.js';
import type { EvaluationAdapter } from '../core/runtime/evaluate.js';
import type { Scenario } from '../core/scenarios.js';

/** Wraps one existing Engine/planner turn, retaining adapter-specific deferral assertions. */
export function plannerAdapter(options: {
  readonly scenario: Scenario;
  readonly arm: RegisteredArm;
  readonly provenance: string;
  readonly runtime: Pick<
    EvalOptions,
    'adapter' | 'fallback' | 'logger' | 'replay'
  >;
}): EvaluationAdapter<RunRecord> {
  return plannerTurnAdapter({ ...options, policy: 'adapter' });
}
