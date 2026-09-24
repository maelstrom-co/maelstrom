import { type Planner, withRetry } from '@maelstrom-co/engine';
import { llmPlanner } from '@maelstrom-co/planner-llm';
import type { AnyTextAdapter } from '@tanstack/ai';
import type { PlannerEvalPlugin } from '../../core/plugin.js';

/** The demo's system rules (apps/demo/src/server/engine-config.ts), so every arm prompts the LLM like the demo. */
export const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

/**
 * Retries of the baseline planner, the same number the staged arms give
 * their fallback, so the baseline is the planner they fall back to.
 */
export const BASELINE_RETRIES = 1;

/** The LLM planner every arm uses as its baseline or fallback, prompted like the demo. */
export function demoLlmPlanner(adapter: AnyTextAdapter): Planner {
  return llmPlanner({
    adapter,
    prompt: { system: { rules: { append: SYSTEM_RULES } } },
  });
}

/**
 * The reference LLM planner as an eval plugin: the `baseline` arm, and the
 * fallback the staged arms of every other plugin run on a deferral. Prompt
 * experiments on `@maelstrom-co/planner-llm` register their arms here.
 */
export const llmPlugin: PlannerEvalPlugin = {
  name: 'llm',
  arms: [
    {
      name: 'baseline',
      baseline: true,
      requiredEnv: ['OPENAI_API_KEY'],
      build: (deps) =>
        withRetry(demoLlmPlanner(deps.adapter('planner')), {
          max: BASELINE_RETRIES,
        }),
    },
  ],
  defaultArms: ['baseline'],
  fallback: demoLlmPlanner,
};
