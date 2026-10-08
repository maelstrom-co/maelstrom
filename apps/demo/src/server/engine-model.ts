import { type AnyTextAdapter, createModel, extendAdapter } from '@tanstack/ai';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';
import {
  type ObservedCall,
  type OpenaiCallListener,
  observeOpenaiCalls,
} from './openai-call-observer';
import type { PlaygroundMetadata } from './playground-metadata';

export const DEFAULT_ENGINE_MODEL = 'gpt-6-luna';

const createLunaChat = extendAdapter(createOpenaiChat, [
  createModel(DEFAULT_ENGINE_MODEL, ['text', 'image']),
]);
type DemoEngineModel = OpenAIChatModel | typeof DEFAULT_ENGINE_MODEL;
const engineCallListeners = new Set<OpenaiCallListener>();

// The Worker build has no `nodejs_compat` flag, so reading `process.env`
// unguarded would throw at import time. Other runtimes can use the override.
const engineModelOverride =
  typeof process !== 'undefined' ? process.env.ENGINE_MODEL?.trim() : undefined;

export const ENGINE_MODEL: DemoEngineModel = engineModelOverride
  ? (engineModelOverride as DemoEngineModel)
  : DEFAULT_ENGINE_MODEL;

/**
 * Planner reasoning effort sent with every Planner call; `default` sends no
 * effort and leaves the model's own default. `PLANNER_REASONING_EFFORT`
 * overrides it on runtimes with `process.env`. `none` matched `low` on mean
 * latency in the /shop smoke but never reasoned, so it never hit the
 * 7 s tail `low` and the model default occasionally did.
 */
export const PLANNER_REASONING_EFFORT =
  (typeof process !== 'undefined'
    ? process.env.PLANNER_REASONING_EFFORT?.trim()
    : undefined) || 'none';

/** Adds the Planner reasoning effort to `modelOptions`. */
export function withPlannerReasoning(
  modelOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (PLANNER_REASONING_EFFORT === 'default') return modelOptions;
  return {
    ...modelOptions,
    reasoning: { effort: PLANNER_REASONING_EFFORT },
  };
}

export function createDemoOpenaiChat(apiKey: string): AnyTextAdapter {
  return observeOpenaiCalls(
    createLunaChat(ENGINE_MODEL, apiKey),
    notifyEngineCallListeners,
  );
}

/**
 * Observes every Planner model call made through {@link createDemoOpenaiChat}
 * until the returned function is called. Engines are shared, so a listener
 * also sees calls other sessions make while it is subscribed.
 */
export function onEngineModelCall(listener: OpenaiCallListener): () => void {
  engineCallListeners.add(listener);
  return () => {
    engineCallListeners.delete(listener);
  };
}

export function engineMetadataFrame(): string {
  return JSON.stringify({
    type: 'playground.metadata',
    engineModel: ENGINE_MODEL,
    source: 'server-configuration',
  } satisfies PlaygroundMetadata);
}

function notifyEngineCallListeners(
  start: Parameters<OpenaiCallListener>[0],
): ObservedCall | undefined {
  const calls = [...engineCallListeners]
    .map((listener) => listener(start))
    .filter((call): call is ObservedCall => call !== undefined);
  if (calls.length === 0) return undefined;
  return {
    onFirstOutput: () => {
      for (const call of calls) call.onFirstOutput();
    },
    onEnd: (end) => {
      for (const call of calls) call.onEnd(end);
    },
  };
}
