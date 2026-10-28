import { noopInstrument, type StageContext } from '@maelstrom-co/engine';
import {
  createTypeSafeClient,
  type Evaluation,
  isScoreAnswer,
  score,
} from '@maelstrom-co/planner-jev/_internal';
import { isErr } from '@maelstrom-co/protocol';
import type { GraderCall } from '../../core/grader.js';
import type { Judge, JudgeAnswer } from '../../core/plugin.js';
import { TYPESAFE_ENV, type TypeSafeSettings } from './typesafe-settings.js';

/**
 * TypeSafe as the grader's judge: one call asking a `score` question per
 * dimension, with the dimension's levels as its criteria. The judge's
 * calls never reach an arm's recorder; each verdict carries its own.
 */
export function createTypeSafeJudge(typesafe: TypeSafeSettings): Judge {
  return {
    requiredEnv: TYPESAFE_ENV,
    get provenance() {
      const model = typesafe().model;
      return {
        kind: 'llm' as const,
        provider: 'typesafe',
        ...(model && { model }),
      };
    },
    async score(input, ctx) {
      const calls: GraderCall[] = [];
      const ask = createTypeSafeClient({
        ...typesafe(),
        onCall: ({ latencyMs, usage, outcome }) =>
          calls.push({ latencyMs, outcome, ...(usage && { usage }) }),
      });
      const evaluation: Evaluation = {
        state: input.state,
        questions: Object.fromEntries(
          input.dimensions.map((dimension) => [
            dimension.name,
            score(dimension.question, dimension.levels),
          ]),
        ),
      };
      // The client reads only the logger, signal and instrument; the judge runs outside any pipeline.
      const result = await ask('grader', evaluation, {
        ...ctx,
        instrument: noopInstrument,
      } as StageContext);
      if (isErr(result))
        return {
          failure:
            result.error._tag === 'Deferred'
              ? result.error.reason
              : result.error.message,
          calls,
        };
      const answers: Record<string, JudgeAnswer> = {};
      for (const dimension of input.dimensions) {
        const answer = result.value.answers[dimension.name];
        if (answer === undefined || !isScoreAnswer(answer))
          return { failure: 'grader/answer_missing', calls };
        answers[dimension.name] = {
          score: answer.score,
          probabilities: answer.probabilities,
        };
      }
      return { answers, calls };
    },
  };
}
