import {
  GridResponseSchema,
  type LayoutMode,
  TilingResponseSchema,
} from '@maelstrom-co/protocol-old';
import { chat, type AnyTextAdapter } from '@tanstack/ai';
import { type GeminiTextModel, geminiText } from '@tanstack/ai-gemini';
import { type OpenAIChatModel, openaiText } from '@tanstack/ai-openai';

import type { AIMessage } from './history/index.js';
import type { LLMProvider, LLMResponse } from './types.js';

export type { GeminiTextModel, OpenAIChatModel };

function getSchemaForMode(layoutMode: LayoutMode) {
  return layoutMode === 'grid' ? GridResponseSchema : TilingResponseSchema;
}

function createProvider(adapter: AnyTextAdapter): LLMProvider {
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

/**
 * Creates an OpenAI-backed Maelstrom provider using TanStack AI's text adapter.
 * The model is bound at provider construction time so request execution can stay
 * transport-agnostic inside the engine.
 */
export function createOpenAIProvider(model: OpenAIChatModel): LLMProvider {
  return createProvider(openaiText(model));
}

/**
 * Creates a Gemini-backed Maelstrom provider using TanStack AI's text adapter.
 * The adapter is preconfigured once so each engine request only supplies prompt
 * and schema data.
 */
export function createTanStackProvider(model: GeminiTextModel): LLMProvider {
  return createProvider(geminiText(model));
}
