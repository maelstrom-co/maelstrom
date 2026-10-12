// PROTOTYPE (MAE-826): throwaway composed Planner, never merge.
/**
 * `withFallback(keepLayoutActionPlanner, withRetry(llmPlanner))`, for
 * `EngineConfig.planner` with Engine `retry: false`. The Planner escalates
 * itself: the light tier answers what one constrained action pick can, and
 * hands everything else to the LLM Planner. Every call is recorded and
 * logged as greppable `[planner-tier]` and `[timing]` lines.
 */
import {
  isDeferred,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
  withFallback,
  withRetry,
} from '@maelstrom-co/engine';
import { isErr } from '@maelstrom-co/protocol';
import {
  type ActionDecider,
  type KeepLayoutActionPlannerOptions,
  type KeepLayoutHandoff,
  type KeepLayoutOutcome,
  keepLayoutActionPlanner,
} from './keep-layout-action-planner';

/** Retries the LLM tier gets; matches the default engine's `retry.max`. */
const LLM_RETRIES = 2;

/** Which tier produced the candidate, or `failed` when neither did. */
export type PlannerTier = 'light' | 'llm' | 'failed';

/** One composed Planner call, as logged on `[planner-tier]`. */
export interface PlannerCallRecord {
  readonly messageId: string;
  readonly sessionId: string;
  readonly tier: PlannerTier;
  /** Why the light tier handed off; null when it answered. */
  readonly handoff: KeepLayoutHandoff | null;
  readonly handoffDetail: string | null;
  /** Where the light tier's action came from. */
  readonly via: KeepLayoutOutcome['via'];
  /** `vesselId.actionName` picked or required, even on a hand-off. */
  readonly action: string | null;
  readonly params: Readonly<Record<string, unknown>> | null;
  readonly confidence: number | null;
  /** The decision-model call alone. */
  readonly decisionMs: number | null;
  /** The whole light tier, decision call and validation included. */
  readonly lightMs: number;
  /** The LLM tier with its retries; null when it did not run. */
  readonly llmMs: number | null;
  readonly totalMs: number;
  /** Error message when the call failed. */
  readonly error: string | null;
}

export interface ComposedPlannerOptions {
  /** The light tier's decision model; null hands every request to the LLM tier. */
  readonly decider: ActionDecider | null;
  /**
   * The full LLM Planner, unwrapped: this wraps it in `withRetry`. Build it
   * with the same `llmPlanner(...)` options the default engine uses.
   */
  readonly llmPlanner: Stage<Retryable<PlanningInput>, PlannerCandidate>;
  /** Retries for the LLM tier. Defaults to 2. */
  readonly llmRetries?: number;
  /**
   * Light-tier knobs: `intentOf` (pass the facade's `plannerIntentOf` so
   * required actions and facts arrive structured), timeout, confidence
   * floor, message and label templates.
   */
  readonly light?: Omit<
    KeepLayoutActionPlannerOptions,
    'decider' | 'onOutcome'
  >;
  /** Called once per Planner call, after the result is known. */
  readonly onRecord?: (record: PlannerCallRecord) => void;
  /** Prints `[planner-tier]` and `[timing]` lines. Defaults to true. */
  readonly log?: boolean;
}

/**
 * Builds the composed Planner. Use with `createEngine({ planner, retry: false })`:
 * the LLM tier retries itself, and an Engine retry would re-run the light
 * tier's decision call for nothing.
 */
export function createComposedPlanner(
  options: ComposedPlannerOptions,
): Planner {
  const outcomes = new WeakMap<PlanningInput, KeepLayoutOutcome>();
  const lightTimes = new WeakMap<PlanningInput, number>();
  const llmTimes = new WeakMap<PlanningInput, number>();
  const log = options.log ?? true;

  const light = keepLayoutActionPlanner({
    ...options.light,
    decider: options.decider,
    onOutcome: (input, outcome) => outcomes.set(input, outcome),
  });
  const llm = withRetry(options.llmPlanner, {
    max: options.llmRetries ?? LLM_RETRIES,
  });
  const composed = withFallback<PlanningInput, PlannerCandidate>(
    timed(light, lightTimes),
    timed(llm, llmTimes),
  );

  return async (input, ctx) => {
    const started = performance.now();
    const result = await composed(input, ctx);
    const outcome = outcomes.get(input);
    const llmMs = llmTimes.get(input) ?? null;
    const failed = isErr(result);
    const record: PlannerCallRecord = {
      messageId: input.messageId,
      sessionId: input.sessionId,
      tier: failed ? 'failed' : llmMs === null ? 'light' : 'llm',
      handoff: outcome?.handoff ?? null,
      handoffDetail: outcome?.detail ?? null,
      via: outcome?.via ?? null,
      action: outcome?.action ?? null,
      params: outcome?.params ?? null,
      confidence: outcome?.confidence ?? null,
      decisionMs: outcome?.decisionMs ?? null,
      lightMs: lightTimes.get(input) ?? 0,
      llmMs,
      totalMs: Math.round(performance.now() - started),
      error: failed
        ? isDeferred(result.error)
          ? `deferred: ${result.error.reason}`
          : result.error.message
        : null,
    };
    if (log) logPlannerRecord(record);
    options.onRecord?.(record);
    return result;
  };
}

/**
 * Prints one call as a `[planner-tier]` JSON line and a `[timing] planner.tier`
 * line, with `extra` fields (for example the call's origin) on both.
 */
export function logPlannerRecord(
  record: PlannerCallRecord,
  extra: Readonly<Record<string, string>> = {},
): void {
  console.log(`[planner-tier] ${JSON.stringify({ ...extra, ...record })}`);
  const fields = Object.entries(extra)
    .map(([key, value]) => ` ${key}=${value}`)
    .join('');
  console.log(
    `[timing] planner.tier${fields} tier=${record.tier} via=${record.via ?? '-'} light=${record.lightMs}ms decision=${record.decisionMs ?? '-'}ms llm=${record.llmMs ?? '-'}ms total=${record.totalMs}ms action=${record.action ?? '-'} handoff=${record.handoff ?? '-'}`,
  );
}

function timed<In extends object>(
  stage: Stage<In, PlannerCandidate>,
  times: WeakMap<In, number>,
): Stage<In, PlannerCandidate> {
  return async (input, ctx) => {
    const started = performance.now();
    try {
      return await stage(input, ctx);
    } finally {
      times.set(input, Math.round(performance.now() - started));
    }
  };
}
