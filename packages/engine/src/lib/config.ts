import type { HistoryConfig } from './history/history-manager.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';
import type { Planner } from './planner/stage.js';
import type { WithRetryOptions } from './planner/with-retry.js';

/** Dependencies and optional policies used to construct an Engine. */
export interface EngineConfig {
  /**
   * Produces the candidate response for every `chart_request`. Start from
   * `llmPlanner({ adapter })` in `@maelstrom-co/planner-llm`, or compose
   * stages with `pipeline` and `withFallback`. The Engine heals and
   * validates whatever the planner returns against the request the client
   * sent.
   */
  readonly planner: Planner;
  /** Optional logger (defaults to consoleLogger). Stages receive it as `StageContext.logger`. */
  readonly logger?: Logger;
  /**
   * Optional history configuration. When omitted, chart_request turns still
   * process normally but nothing is recorded, and assistant_message messages
   * produce a validationError ('history not configured') since they have
   * nowhere to be injected.
   */
  readonly history?: HistoryConfig;
  /**
   * Retry policy the Engine wraps around {@link EngineConfig.planner} with
   * `withRetry`. `{ max }` re-runs the planner up to `max` times while
   * healing recommends a retry (`max` is a non-negative integer). `false`
   * (or `{ max: 0 }`) runs the planner once; the Engine still heals and
   * validates the candidate. Use `false` for planners that retry their own
   * steps. Default `{ max: 1 }`. See the README's Retry section for the full
   * policy.
   */
  readonly retry?: WithRetryOptions | false;
}

/** {@link EngineConfig} with every default applied. */
export interface ResolvedEngineConfig {
  /** The configured planner, not yet wrapped in the retry policy. */
  readonly planner: Planner;
  /** The configured logger, or {@link consoleLogger}. */
  readonly logger: Logger;
  /** The configured history, or `undefined` when history is off. */
  readonly history: HistoryConfig | undefined;
  /** The configured retry policy, or `{ max: 1 }`. */
  readonly retry: WithRetryOptions | false;
}

const DEFAULT_RETRY: WithRetryOptions = { max: 1 };

/**
 * Applies Engine defaults without cloning configured dependencies.
 *
 * The logger defaults to {@link consoleLogger} and `retry` to `{ max: 1 }`;
 * history remains optional.
 */
export function resolveConfig(config: EngineConfig): ResolvedEngineConfig {
  return {
    planner: config.planner,
    logger: config.logger ?? consoleLogger,
    history: config.history,
    retry: config.retry ?? DEFAULT_RETRY,
  };
}
