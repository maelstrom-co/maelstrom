import type { AnyTextAdapter } from '@tanstack/ai';

import type { HistoryConfig } from './history/history-manager.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';
import type { Planner } from './planning/contracts.js';
import type { PromptOptions } from './prompt/prompt-builder.js';

/**
 * `heal-and-ship` permits a renderable subset after recommended repairs.
 * `strict` rejects material layout changes or dropped actions, but accepts
 * valid empty plans and omitted presentation text.
 */
export type FinalizationPolicy = 'heal-and-ship' | 'strict';

/** Conditions that may start the single configured fallback route. */
export type FallbackTrigger =
  | 'deferred'
  | 'invalid_plan'
  | 'provider_error'
  | 'invalid_provider_response';

/** One planner route controlled by the engine operation loop. */
export interface PlannerRoute {
  /** Provider-neutral planner implementation. */
  readonly implementation: Planner;
  /** Policy applied to healed candidates. */
  readonly finalization: FinalizationPolicy;
  /** Non-negative integer repair limit after the initial call; zero disables repair. */
  readonly maxRepairAttempts: number;
}

/** The one optional fallback route. */
export interface FallbackPlannerRoute extends PlannerRoute {
  /**
   * Non-empty reasons that permit the single primary-to-fallback transition.
   * Cancellation, deadline expiry, and exhausted calls never permit fallback.
   */
  readonly on: readonly FallbackTrigger[];
}

/** Explicit provider-neutral planner configuration. */
export interface ExplicitPlannerConfig {
  /** Required primary planner route. */
  readonly primary: PlannerRoute;
  /** Optional single fallback route with no nested fallback. */
  readonly fallback?: FallbackPlannerRoute;
  /** Whole-operation deadline and shared logical provider-call budget. */
  readonly operation: {
    /** Positive finite integer milliseconds for all routes and repairs, or null to disable. */
    readonly timeoutMs: number | null;
    /** Positive integer call count shared by all stages, repairs, and fallback. */
    readonly maxProviderCalls: number;
  };
}

/** Existing adapter shorthand that preserves legacy heal-and-ship behavior. */
export interface AdapterEngineConfig {
  /** TanStack AI text adapter. */
  readonly adapter: AnyTextAdapter;
  /** Optional logger. */
  readonly logger?: Logger;
  /** Optional prompt customization. */
  readonly prompt?: PromptOptions;
  /** Optional persisted history configuration. */
  readonly history?: HistoryConfig;
  /** Legacy engine-owned repair count. Defaults to one. */
  readonly maxRetries?: number;
  /** Provider options passed to every conventional LLM chat call. */
  readonly modelOptions?: Record<string, unknown>;
  /** Whole-operation timeout; null and omission disable it. */
  readonly operationTimeoutMs?: number | null;
  /** Logical chat invocation budget. Defaults to maxRetries plus one. */
  readonly maxProviderCalls?: number;
  /** Prevents mixing shorthand and explicit planner configuration. */
  readonly planner?: never;
}

/** Explicit planner route configuration without root LLM-only options. */
export interface PlannerEngineConfig {
  /** Explicit primary and optional fallback planner routes. */
  readonly planner: ExplicitPlannerConfig;
  /** Optional logger. */
  readonly logger?: Logger;
  /** Optional persisted history configuration. */
  readonly history?: HistoryConfig;
  /** Prevents mixing shorthand and explicit planner configuration. */
  readonly adapter?: never;
  /** Rejected because prompt customizes only createLlmPlanner. */
  readonly prompt?: never;
  /** Rejected because retries belong to explicit routes. */
  readonly maxRetries?: never;
  /** Rejected because model options belong to createLlmPlanner. */
  readonly modelOptions?: never;
  /** Rejected because timeout belongs to planner.operation. */
  readonly operationTimeoutMs?: never;
  /** Rejected because budget belongs to planner.operation. */
  readonly maxProviderCalls?: never;
}

/** Dependencies and policy used to construct an Engine. */
export type EngineConfig = AdapterEngineConfig | PlannerEngineConfig;

/** Resolved fields retained for adapter-shorthand consumers. */
export interface ResolvedAdapterEngineConfig {
  /** Original adapter, retained by identity. */
  readonly adapter: AnyTextAdapter;
  /** Logger with its default applied. */
  readonly logger: Logger;
  /** Prompt options with the empty default applied. */
  readonly prompt: PromptOptions;
  /** History configuration, when enabled. */
  readonly history: HistoryConfig | undefined;
  /** Retry count with the compatibility default applied. */
  readonly maxRetries: number;
  /** Provider model options. */
  readonly modelOptions: Record<string, unknown> | undefined;
  /** Whole-operation timeout with the disabled default applied. */
  readonly operationTimeoutMs: number | null;
  /** Logical call budget with the compatibility default applied. */
  readonly maxProviderCalls: number;
}

/** Resolved explicit planner configuration. */
export interface ResolvedPlannerEngineConfig {
  /** Logger with its default applied. */
  readonly logger: Logger;
  /** History configuration, when enabled. */
  readonly history: HistoryConfig | undefined;
  /** Complete explicit route configuration. */
  readonly planner: ExplicitPlannerConfig;
}

/** Resolved engine configuration for either construction arm. */
export type ResolvedEngineConfig =
  | ResolvedAdapterEngineConfig
  | ResolvedPlannerEngineConfig;

const DEFAULT_MAX_RETRIES = 1;

/** Resolves defaults without cloning configured dependencies. */
export function resolveConfig(
  config: AdapterEngineConfig,
): ResolvedAdapterEngineConfig;
/** Resolves the explicit planning route without changing its implementation. */
export function resolveConfig(
  config: PlannerEngineConfig,
): ResolvedPlannerEngineConfig;
/** Resolves configuration whose construction arm is selected at runtime. */
export function resolveConfig(config: EngineConfig): ResolvedEngineConfig;
export function resolveConfig(config: EngineConfig): ResolvedEngineConfig {
  const logger = config.logger ?? consoleLogger;
  if ('adapter' in config && config.adapter !== undefined) {
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    return {
      adapter: config.adapter,
      logger,
      prompt: config.prompt ?? {},
      history: config.history,
      maxRetries,
      modelOptions: config.modelOptions,
      operationTimeoutMs: config.operationTimeoutMs ?? null,
      maxProviderCalls: config.maxProviderCalls ?? maxRetries + 1,
    };
  }
  return { logger, history: config.history, planner: config.planner };
}
