import type { AnyTextAdapter } from '@tanstack/ai';

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
}

export function resolveConfig(config: EngineConfig): Required<EngineConfig> {
  return {
    ...config,
    logger: config.logger ?? consoleLogger,
    prompt: config.prompt ?? {},
  };
}
