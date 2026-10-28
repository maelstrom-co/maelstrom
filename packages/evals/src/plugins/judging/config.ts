import {
  type JudgeConfig,
  type JudgeRubric,
  MissingJudgeEnvironment,
} from '../../core/judge.js';
import type { Judge } from '../../core/plugin.js';
import { createTypeSafeJudge } from '../jev/typesafe-judge.js';
import { createHeuristicJudge, createOpenAIJudge } from './providers.js';

/** Validates enabled configuration before any evaluation work; environment is caller-supplied. */
export function configureJudge(
  explicit: JudgeConfig,
  env: Readonly<Record<string, string | undefined>>,
): { readonly judge?: Judge; readonly judgeRubric?: JudgeRubric } {
  const invoked =
    explicit.provider !== undefined ||
    explicit.model !== undefined ||
    explicit.rubric !== undefined;
  const flag = env.MAELSTROM_ENABLE_LLM_JUDGE?.trim().toLowerCase();
  if (
    explicit.enabled === undefined &&
    !invoked &&
    flag !== undefined &&
    !['true', 'false', '1', '0', ''].includes(flag)
  )
    throw new Error('MAELSTROM_ENABLE_LLM_JUDGE must be true/false or 1/0');
  const enabled =
    explicit.enabled ?? (invoked || flag === 'true' || flag === '1');
  if (!enabled) return {};
  const legacy = explicit.enabled === undefined && !invoked;
  const provider =
    explicit.provider ??
    env.MAELSTROM_LLM_JUDGE_PROVIDER ??
    (legacy ? 'heuristic' : 'typesafe');
  const judgeRubric =
    explicit.rubric ??
    env.MAELSTROM_LLM_JUDGE_RUBRIC ??
    (legacy ? 'legacy' : 'surface');
  if (judgeRubric !== 'surface' && judgeRubric !== 'legacy')
    throw new Error('Judge rubric must be surface or legacy');
  if (provider === 'heuristic') {
    if (judgeRubric !== 'legacy')
      throw new Error('Heuristic judging requires the legacy text rubric');
    return { judge: createHeuristicJudge(), judgeRubric };
  }
  if (provider !== 'typesafe' && provider !== 'openai')
    throw new Error('Judge provider must be typesafe, openai or heuristic');
  const model = (
    explicit.model ??
    env.MAELSTROM_LLM_JUDGE_MODEL ??
    (provider === 'typesafe' ? env.JEV_MODEL : 'gpt-5.4-mini')
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
          env.MAELSTROM_LLM_JUDGE_MODEL !== undefined
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
