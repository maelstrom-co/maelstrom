import type { AnyTextAdapter } from '@tanstack/ai';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';
import type { PlaygroundMetadata } from './playground-metadata';

/** Default model for the demo's server-owned planning requests. */
export const DEFAULT_ENGINE_MODEL = 'gpt-6-luna' satisfies OpenAIChatModel;

// The Worker build has no `nodejs_compat` flag, so reading `process.env`
// unguarded would throw at import time. Other runtimes can use the override.
const engineModelOverride =
  typeof process !== 'undefined' ? process.env.ENGINE_MODEL?.trim() : undefined;

/** Model resolved at module load; blank overrides use the default. */
export const ENGINE_MODEL: OpenAIChatModel = engineModelOverride
  ? (engineModelOverride as OpenAIChatModel)
  : DEFAULT_ENGINE_MODEL;

/** Creates the configured OpenAI adapter with the caller's API key. */
export function createDemoOpenaiChat(apiKey: string): AnyTextAdapter {
  return createOpenaiChat(ENGINE_MODEL, apiKey);
}

export function engineMetadataFrame(): string {
  return JSON.stringify({
    type: 'playground.metadata',
    engineModel: ENGINE_MODEL,
    source: 'server-configuration',
  } satisfies PlaygroundMetadata);
}
