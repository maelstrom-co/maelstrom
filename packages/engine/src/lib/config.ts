import type { HistoryConfig } from './history/history-manager.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';
import type { Instrument } from './planner/instrument.js';
import { noopInstrument } from './planner/instrument.js';
import type { PlanValidator } from './planner/plan-validator.js';
import type { ClarifyingPlanner } from './planner/stage.js';
import type { WithRetryOptions } from './planner/with-retry.js';

/** Dependencies and optional policies used to construct an Engine. */
export interface EngineConfig {
  /**
   * Produces the candidate response for every `chart_request`. Use a
   * planner implementation as is, or compose stages with `pipeline` and
   * `withFallback`. The Engine heals and
   * validates whatever the planner returns against the request the client
   * sent. Validation accepts a needs-clarification result only for a request
   * that set `skipReply: true`, and `Engine.handle` currently refuses it even
   * then with `Err(ValidationError)` on field `skipReply`.
   */
  readonly planner: ClarifyingPlanner;
  /**
   * Optional synchronous check of application requirements on the healed response.
   * Issues use the configured retry budget. Unresolved issues return a
   * ValidationError on `validatePlan`, including when retries are disabled.
   * Without this hook, the existing healing and retry policy is unchanged.
   */
  readonly validatePlan?: PlanValidator;
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
   * Optional telemetry seam (defaults to `noopInstrument`). Stages receive it
   * as `StageContext.instrument`; `pipeline` wraps every stage with
   * `instrument.stage` per request, and stages report model calls and other
   * events through `instrument.event`.
   */
  readonly instrument?: Instrument;
  /**
   * Retry policy the Engine wraps around {@link EngineConfig.planner} with
   * `withRetry`. `{ max }` re-runs the planner up to `max` times while
   * validation recommends a retry (`max` is a non-negative integer). `false`
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
  readonly planner: ClarifyingPlanner;
  /** The application requirement check, or `undefined` when not configured. */
  readonly validatePlan: PlanValidator | undefined;
  /** The configured logger, or {@link consoleLogger}. */
  readonly logger: Logger;
  /** The configured history, or `undefined` when history is off. */
  readonly history: HistoryConfig | undefined;
  /** The configured instrument, or {@link noopInstrument}. */
  readonly instrument: Instrument;
  /** The configured retry policy, or `{ max: 1 }`. */
  readonly retry: WithRetryOptions | false;
}

const DEFAULT_RETRY: WithRetryOptions = { max: 1 };

/**
 * Applies Engine defaults without cloning configured dependencies.
 *
 * The logger defaults to {@link consoleLogger}, the instrument to
 * {@link noopInstrument} and `retry` to `{ max: 1 }`;
 * history remains optional.
 */
export function resolveConfig(config: EngineConfig): ResolvedEngineConfig {
  return {
    planner: config.planner,
    validatePlan: config.validatePlan,
    logger: config.logger ?? consoleLogger,
    history: config.history,
    instrument: config.instrument ?? noopInstrument,
    retry: config.retry ?? DEFAULT_RETRY,
  };
}
