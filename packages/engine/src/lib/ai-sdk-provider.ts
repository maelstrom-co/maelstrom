import { chat } from '@tanstack/ai';
import { type GeminiTextModel, geminiText } from '@tanstack/ai-gemini';

import {
  GridResponseSchema,
  type LayoutMode,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';

import type { AIMessage } from './history/index.js';
import type { LLMProvider, LLMResponse } from './types.js';

export type { GeminiTextModel };

function getSchemaForMode(layoutMode: LayoutMode) {
  return layoutMode === 'grid' ? GridResponseSchema : TilingResponseSchema;
}

export function createTanStackProvider(model: GeminiTextModel): LLMProvider {
  const adapter = geminiText(model);

  return {
    async complete(
      prompt: string,
      systemPrompt: string,
      layoutMode: LayoutMode,
    ): Promise<LLMResponse> {
      const result = await chat({
        adapter,
        messages: [{ role: 'user', content: prompt }],
        systemPrompts: [systemPrompt],
        outputSchema: getSchemaForMode(layoutMode),
        stream: false,
      });

      return result;
    },

    async completeWithHistory(
      messages: AIMessage[],
      currentPrompt: string,
      systemPrompt: string,
      layoutMode: LayoutMode,
    ): Promise<LLMResponse> {
      const chatMessages = [
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: currentPrompt },
      ];

      const result = await chat({
        adapter,
        messages: chatMessages,
        systemPrompts: [systemPrompt],
        outputSchema: getSchemaForMode(layoutMode),
        stream: false,
      });

      return result;
    },
  };
}
