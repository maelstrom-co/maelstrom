import {
  type JudgeConfig,
  type JudgeRubric,
  judgeEvidence,
  validateJudgeSelection,
} from '../core/judge.js';
import { judgeNotRun } from '../core/judge-result.js';
import type { Judge } from '../core/plugin.js';
import type { EvaluationResult } from '../core/runtime/evaluate.js';
import { configureJudge } from '../plugins/judging/config.js';

/** Optional explicit overrides; a supplied provider can be fake in offline verification. */
export interface ManualJudgeOptions {
  /** Explicit settings override environment defaults, including disabling judging. */
  readonly configuration?: JudgeConfig;
  /** Explicit provider injection; never installed implicitly by the probe. */
  readonly judge?: Judge;
}

/** Configures secondary judging without relaxing the manual planner's dispatch guard. */
export function manualJudge(
  definition: { readonly inputs: unknown; readonly expectations: unknown },
  env: Readonly<Record<string, string | undefined>>,
  options: ManualJudgeOptions,
) {
  const configured =
    options.configuration?.enabled === false
      ? {}
      : options.judge
        ? {
            judge: options.judge,
            judgeRubric: (options.configuration?.rubric ??
              'surface') as JudgeRubric,
          }
        : configureJudge(options.configuration ?? {}, env);
  validateJudgeSelection(configured.judge, configured.judgeRubric);
  const calls = { attempts: 0, reportedCalls: 0, unknownAttempts: 0 };
  const provider = configured.judge;
  if (!provider) return { calls };
  const counted: Judge = {
    ...provider,
    async score(input, context) {
      calls.attempts++;
      try {
        const result = await provider.score(input, context);
        calls.reportedCalls += result.calls.length;
        return result;
      } catch (error) {
        calls.unknownAttempts++;
        throw error;
      }
    },
  };
  return {
    calls,
    async judge(result: EvaluationResult<unknown>) {
      const turns = result.records
        .filter((record) => record.kind === 'turn')
        .map((record) => record.value);
      const observation =
        result.observation ?? (turns.length ? turns : undefined);
      if (
        observation === undefined ||
        (Array.isArray(observation) && observation.length === 0)
      )
        return judgeNotRun('no_valid_evidence');
      const last: unknown = Array.isArray(observation)
        ? observation.at(-1)
        : observation;
      const value =
        last && typeof last === 'object'
          ? (last as Record<string, unknown>)
          : {};
      const response =
        value.response && typeof value.response === 'object'
          ? (value.response as Record<string, unknown>)
          : value;
      const assistantText = response.userMessage;
      const expected =
        definition.expectations && typeof definition.expectations === 'object'
          ? (definition.expectations as Record<string, unknown>)
          : {};
      const expectedText = expected.exactText ?? expected.exact_text;
      return judgeEvidence(
        counted,
        configured.judgeRubric === 'legacy' ? 'legacy_task' : 'session_outcome',
        {
          inputs: definition.inputs,
          expectations: definition.expectations,
          observation,
          completeness: result.completeness,
          ...(typeof assistantText === 'string' && { assistantText }),
          ...(typeof expectedText === 'string' && { expectedText }),
        },
        { logger: { debug() {}, info() {}, warn() {}, error() {} } },
      );
    },
  };
}
