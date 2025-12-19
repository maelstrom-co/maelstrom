import { generateText } from 'ai';
import type { LanguageModelV1 } from 'ai';
import type { LLMProvider } from './types.js';

/**
 * Creates an LLMProvider from an AI SDK model.
 *
 * @example
 * ```typescript
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { createAISDKProvider } from '@maelstrom/engine';
 *
 * const provider = createAISDKProvider(anthropic('claude-sonnet-4-20250514'));
 * ```
 *
 * @example
 * ```typescript
 * import { google } from '@ai-sdk/google';
 * import { createAISDKProvider } from '@maelstrom/engine';
 *
 * const provider = createAISDKProvider(google('gemini-2.0-flash'));
 * ```
 */
export function createAISDKProvider(model: LanguageModelV1): LLMProvider {
  return {
    async complete(prompt: string, systemPrompt: string): Promise<string> {
      const result = await generateText({
        model,
        system: systemPrompt,
        prompt,
      });

      return result.text;
    },
  };
}
