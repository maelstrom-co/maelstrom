import {
  type RegisteredStageEval,
  registerStageEval,
} from '../../core/stage-eval.js';
import { layoutStageEval } from './stages/layout.js';

/** Stage evals by the `--stage` name that selects them. */
export const STAGE_EVALS: Readonly<Record<string, RegisteredStageEval>> = {
  layout: registerStageEval(layoutStageEval),
};
