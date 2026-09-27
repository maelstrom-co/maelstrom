import { type AnyTextAdapter, createModel, extendAdapter } from '@tanstack/ai';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';
import type { PlaygroundMetadata } from './playground-metadata';

export const DEFAULT_ENGINE_MODEL = 'gpt-6-luna';

const createLunaChat = extendAdapter(createOpenaiChat, [
  createModel(DEFAULT_ENGINE_MODEL, ['text', 'image']),
]);
type DemoEngineModel = OpenAIChatModel | typeof DEFAULT_ENGINE_MODEL;

// The Worker build has no `nodejs_compat` flag, so reading `process.env`
// unguarded would throw at import time. Other runtimes can use the override.
const engineModelOverride =
  typeof process !== 'undefined' ? process.env.ENGINE_MODEL?.trim() : undefined;

export const ENGINE_MODEL: DemoEngineModel = engineModelOverride
  ? (engineModelOverride as DemoEngineModel)
  : DEFAULT_ENGINE_MODEL;

export function createDemoOpenaiChat(apiKey: string): AnyTextAdapter {
  return createLunaChat(ENGINE_MODEL, apiKey);
}

export function engineMetadataFrame(): string {
  return JSON.stringify({
    type: 'playground.metadata',
    engineModel: ENGINE_MODEL,
    source: 'server-configuration',
  } satisfies PlaygroundMetadata);
}
