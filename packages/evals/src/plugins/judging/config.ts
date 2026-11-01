import {
  type JudgeConfig,
  type JudgeRubric,
  judgeEnvironmentValue,
  MissingJudgeEnvironment,
  resolveJudgeSelection,
} from '../../core/judge.js';
import type { Judge } from '../../core/plugin.js';
import { createTypeSafeJudge } from '../jev/typesafe-judge.js';
import { createHeuristicJudge, createOpenAIJudge } from './providers.js';

/** Validates enabled configuration before any evaluation work; environment is caller-supplied. */
export function configureJudge(
  explicit: JudgeConfig,
  env: Readonly<Record<string, string | undefined>>,
): { readonly judge?: Judge; readonly judgeRubric?: JudgeRubric } {
  const selection = resolveJudgeSelection(explicit, env);
  if (!selection) return {};
  const judgeRubric = selection.rubric;
  const provider =
    explicit.provider ??
    judgeEnvironmentValue(env.MAELSTROM_LLM_JUDGE_PROVIDER) ??
    (selection.legacyDefaults ? 'heuristic' : 'typesafe');
  if (provider === 'heuristic') {
    if (judgeRubric !== 'legacy')
      throw new Error('Heuristic judging requires the legacy text rubric');
    return { judge: createHeuristicJudge(), judgeRubric };
  }
  if (provider !== 'typesafe' && provider !== 'openai')
    throw new Error('Judge provider must be typesafe, openai or heuristic');
  const environmentModel = judgeEnvironmentValue(env.MAELSTROM_LLM_JUDGE_MODEL);
  const model = (
    explicit.model ??
    environmentModel ??
    (provider === 'typesafe'
      ? judgeEnvironmentValue(env.JEV_MODEL)
      : 'gpt-5.4-mini')
  )?.trim();
  const apiKey =
    env[
      provider === 'typesafe' ? 'TYPESAFE_API_KEY' : 'OPENAI_API_KEY'
    ]?.trim();
  if (explicit.model !== undefined && !model)
    throw new Error('Enabled judge requires a nonempty model');
  const missing = [
    ...(!apiKey
      ? [provider === 'typesafe' ? 'TYPESAFE_API_KEY' : 'OPENAI_API_KEY']
      : []),
    ...(!model
      ? [
          environmentModel !== undefined
            ? 'MAELSTROM_LLM_JUDGE_MODEL'
            : 'JEV_MODEL',
        ]
      : []),
  ];
  if (!model || !apiKey) throw new MissingJudgeEnvironment(missing);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model))
    throw new Error('Invalid judge model identifier');
  const judge =
    provider === 'openai'
      ? createOpenAIJudge({ model, apiKey })
      : { ...createTypeSafeJudge(() => ({ model, apiKey })), requiredEnv: [] };
  return { judge, judgeRubric };
}
