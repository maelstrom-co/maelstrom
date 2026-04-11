import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';

export interface EngineConfig {
  /** TanStack AI model identifier (e.g. 'gemini-2.0-flash') */
  readonly model: string;
  /** Optional logger (defaults to consoleLogger) */
  readonly logger?: Logger;
}

export function resolveConfig(config: EngineConfig): Required<EngineConfig> {
  return { ...config, logger: config.logger ?? consoleLogger };
}
