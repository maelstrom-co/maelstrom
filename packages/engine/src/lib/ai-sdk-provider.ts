import type { LanguageModel } from 'ai';
import { generateText } from 'ai';
import type { AIMessage } from './history/index.js';
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
export function createAISDKProvider(model: LanguageModel): LLMProvider {
  return {
    async complete(prompt: string, systemPrompt: string): Promise<string> {
      const result = await generateText({
        model,
        system: systemPrompt,
        prompt,
      });

      return result.text;
    },

    async completeWithHistory(
      messages: AIMessage[],
      currentPrompt: string,
      systemPrompt: string,
    ): Promise<string> {
      // Convert history messages and append current prompt as user message
      const aiMessages = [
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: currentPrompt },
      ];

      const result = await generateText({
        model,
        system: systemPrompt,
        messages: aiMessages,
      });

      return result.text;
    },
  };
}
