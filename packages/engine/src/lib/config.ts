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
}

export interface ResolvedEngineConfig {
  readonly adapter: AnyTextAdapter;
  readonly logger: Logger;
  readonly prompt: PromptOptions;
  readonly history: HistoryConfig | undefined;
}

export function resolveConfig(config: EngineConfig): ResolvedEngineConfig {
  return {
    adapter: config.adapter,
    logger: config.logger ?? consoleLogger,
    prompt: config.prompt ?? {},
    history: config.history,
  };
}
