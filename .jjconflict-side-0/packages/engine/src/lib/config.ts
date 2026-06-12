import type { AnyTextAdapter } from '@tanstack/ai';

import type { HistoryConfig } from './history/history-manager.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';
import type { PromptOptions } from './prompt/prompt-builder.js';

export interface EngineConfig {
  /** TanStack AI text adapter (e.g. geminiText('gemini-2.0-flash'), openaiText('gpt-4o')) */
  readonly adapter: AnyTextAdapter;
  /** Optional logger (defaults to consoleLogger) */
  readonly logger?: Logger;
  /** Section-based prompt customization */
  readonly prompt?: PromptOptions;
  /**
   * Optional history configuration. When omitted, chart_request turns still
   * process normally but nothing is recorded, and assistant_message messages
   * produce a validationError ('history not configured') since they have
   * nowhere to be injected.
   */
  readonly history?: HistoryConfig;
  /**
   * Maximum number of retry attempts after the heal layer flags
   * `retryHint.recommend === true`. Non-negative integer; default `1`.
   * Set to `0` to disable retries (the layer stays wired for observability).
   * See the README's Retry section for the full policy.
   */
  readonly maxRetries?: number;
}

export interface ResolvedEngineConfig {
  readonly adapter: AnyTextAdapter;
  readonly logger: Logger;
  readonly prompt: PromptOptions;
  readonly history: HistoryConfig | undefined;
  readonly maxRetries: number;
}

const DEFAULT_MAX_RETRIES = 1;

export function resolveConfig(config: EngineConfig): ResolvedEngineConfig {
  return {
    adapter: config.adapter,
    logger: config.logger ?? consoleLogger,
    prompt: config.prompt ?? {},
    history: config.history,
    maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
  };
}
