import type { AnyTextAdapter } from '@tanstack/ai';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';

export const DEFAULT_ENGINE_MODEL = 'gpt-5.6-luna' satisfies OpenAIChatModel;

// The Worker build has no `nodejs_compat` flag, so reading `process.env`
// unguarded would throw at import time. Other runtimes can use the override.
const engineModelOverride =
  typeof process !== 'undefined' ? process.env.ENGINE_MODEL?.trim() : undefined;

export const ENGINE_MODEL: OpenAIChatModel = engineModelOverride
  ? (engineModelOverride as OpenAIChatModel)
  : DEFAULT_ENGINE_MODEL;

export function createDemoOpenaiChat(apiKey: string): AnyTextAdapter {
  return createOpenaiChat(ENGINE_MODEL, apiKey);
}
