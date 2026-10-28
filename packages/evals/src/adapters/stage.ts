import type { JudgeRubric } from '../core/judge.js';
import type { Judge } from '../core/plugin.js';
import type { EvaluationAdapter } from '../core/runtime/evaluate.js';
import type { Scenario } from '../core/scenarios.js';
import type {
  RegisteredStageEval,
  StageTurnRecord,
} from '../core/stage-eval.js';

/** Uses the same isolated-stage turn lifecycle as the native stage batch runner. */
export function stageAdapter(options: {
  readonly module: RegisteredStageEval;
  readonly scenario: Scenario;
  readonly variant: string;
  readonly provenance: string;
  readonly judge?: Judge;
  readonly judgeRubric?: JudgeRubric;
}): EvaluationAdapter<StageTurnRecord> {
  return options.module.adapter(options);
}
