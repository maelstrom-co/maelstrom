import { layoutStageEval } from './layout.js';
import { type RegisteredStageEval, registerStageEval } from './stage-eval.js';

/** Stage evals by the `--stage` name that selects them. */
export const STAGE_EVALS: Readonly<Record<string, RegisteredStageEval>> = {
  layout: registerStageEval(layoutStageEval),
};
