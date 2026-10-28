import type { Planner } from '@maelstrom-co/engine';
import { llmPlanner } from '@maelstrom-co/planner-llm';
import { createOpenaiChat } from '@tanstack/ai-openai';
import { localPlanner } from './local-planner';

export type StarterMode = 'local' | 'openai';
export const model = 'gpt-6-luna';

/** Creates a provider only when the server explicitly selects live mode. */
export function createStarterPlanner(options: {
  mode: StarterMode;
  apiKey?: string;
  baseURL?: string;
}): Planner {
  if (options.mode === 'local') return localPlanner;
  if (!options.apiKey?.trim())
    throw new Error(
      'Live mode needs OPENAI_API_KEY in .env.local. See the README.',
    );
  const live = llmPlanner({
    adapter: createOpenaiChat(model, options.apiKey, {
      timeout: 20_000,
      maxRetries: 0,
      logLevel: 'off',
      ...(options.baseURL && { baseURL: options.baseURL }),
    }),
    modelOptions: {
      max_output_tokens: 2048,
      reasoning: { effort: 'none' },
    },
  });
  return (input, context) =>
    input.request.context.updateReasons.some(
      (reason) => reason.type === 'user_intent',
    )
      ? live(input, context)
      : localPlanner(input, context);
}
