import type {
  GridResponse,
  GridResponseWithoutReply,
  MaelstromResponse,
  NeedsClarification,
  TilingResponse,
  TilingResponseWithoutReply,
} from '@maelstrom-co/protocol';

import type { SkippedAction } from '../response/execution-plan/types.js';
import type {
  DroppedLayoutEntry,
  LayoutWarning,
  RetryHint,
} from '../validation/llm-output/healed-layout.js';

/**
 * The raw plan a planner produces: the structured output shape for the
 * request's layout mode, before the Engine heals and validates it. A grid
 * request expects a `GridResponse`; a tiling request a `TilingResponse`.
 *
 * A candidate is immutable. Validation results are cached per candidate
 * object, so a stage that wants a different plan must return a new object
 * rather than edit one it received or already validated.
 */
export type PlannerCandidate =
  | DeepReadonly<GridResponse>
  | DeepReadonly<TilingResponse>;

/**
 * A {@link PlannerCandidate} that may omit `userMessage`, for a request that
 * set `skipReply: true`. A grid request expects a `GridResponseWithoutReply`;
 * a tiling request a `TilingResponseWithoutReply`. Without that flag the
 * Engine rejects a candidate whose `userMessage` is missing or blank.
 *
 * Every {@link PlannerCandidate} is a `ReplylessCandidate`. Like a
 * `PlannerCandidate`, it is immutable: validation results are cached per
 * candidate object.
 */
export type ReplylessCandidate =
  | DeepReadonly<GridResponseWithoutReply>
  | DeepReadonly<TilingResponseWithoutReply>;

/**
 * Everything a planner may return: a {@link PlannerCandidate}, a
 * {@link ReplylessCandidate}, or a {@link NeedsClarification} when it cannot
 * proceed without asking the user. Validation accepts a replyless candidate
 * without `userMessage` and a needs-clarification result only for a request
 * that set `skipReply: true`, and `Engine.handle` currently refuses both even
 * then with `Err(ValidationError)` on field `skipReply`.
 */
export type PlannerOutput =
  | PlannerCandidate
  | ReplylessCandidate
  | NeedsClarification;

/**
 * The narrowest of {@link PlannerCandidate}, {@link ReplylessCandidate} and
 * {@link PlannerOutput} that contains `Out`. `pipeline` types the planner it
 * builds with it, so a pipeline whose last stage returns strict candidates
 * is a plain `Planner`.
 *
 * @typeParam Out - What the last stage of a planner produces.
 */
export type WidenedPlannerOutput<Out extends PlannerOutput> = [Out] extends [
  PlannerCandidate,
]
  ? PlannerCandidate
  : [Out] extends [ReplylessCandidate]
    ? ReplylessCandidate
    : PlannerOutput;

/**
 * A summary of what healing changed in a candidate and whether another
 * attempt is worth it. Planner stages see it through `StageContext.validate`
 * and `RetryFeedback`; it is stripped from the response before it crosses the
 * Engine boundary. The detailed per-entry records stay inside the Engine.
 */
export interface EngineDiagnostics {
  /** Severity of the healed result and whether the Engine recommends a retry. */
  readonly retryHint: RetryHint;
  /** How many entries of each kind healing produced. */
  readonly counts: {
    /** Proposed actions the Engine refused to plan. */
    readonly skippedActions: number;
    /** Layout entries healing removed. */
    readonly droppedLayoutEntries: number;
    /** Repairs healing applied without removing anything from the layout. */
    readonly warnings: number;
  };
  /**
   * Sanitized, length-limited description of what healing changed, written
   * for a model and ready to paste into a retry prompt. Empty when there is
   * nothing a planner can act on.
   */
  readonly feedback: string;
}

/**
 * Candidate after the Engine healed and validated it against the original
 * request: the response that would ship, plus the diagnostics describing what
 * healing changed. The diagnostics never cross the Engine boundary.
 */
export type ValidatedCandidate = MaelstromResponse & {
  /** What healing changed, and whether a retry is recommended. */
  readonly diagnostics: EngineDiagnostics;
};

/**
 * A {@link ReplylessCandidate} after the Engine healed and validated it: a
 * {@link ValidatedCandidate} whose `userMessage` may be absent.
 */
export type ValidatedReplylessCandidate = Omit<
  MaelstromResponse,
  'userMessage'
> & {
  /**
   * The reply to the user. Always present unless the request set
   * `skipReply: true`, in which case the planner may have omitted it. A blank
   * reply under `skipReply: true` is dropped, so a present value is never
   * blank.
   */
  readonly userMessage?: string;
  /** What healing changed, and whether a retry is recommended. */
  readonly diagnostics: EngineDiagnostics;
};

/** {@link EngineDiagnostics} plus the detailed records the Engine logs. */
export interface FullDiagnostics extends EngineDiagnostics {
  readonly skippedActions: readonly SkippedAction[];
  readonly droppedLayoutEntries: readonly DroppedLayoutEntry[];
  readonly warnings: readonly LayoutWarning[];
}

export type DiagnosticRecords = Omit<FullDiagnostics, 'counts' | 'feedback'>;

/** A {@link ValidatedCandidate} as the Engine sees it, with full diagnostics. */
export type FullValidatedCandidate = ValidatedCandidate & {
  readonly diagnostics: FullDiagnostics;
};

/**
 * A {@link ValidatedReplylessCandidate} as the Engine sees it, with full
 * diagnostics.
 */
export type FullValidatedReplylessCandidate = ValidatedReplylessCandidate & {
  readonly diagnostics: FullDiagnostics;
};

/**
 * A needs-clarification result the Engine accepted. Its diagnostics are
 * empty and never recommend a retry: there is no layout to heal.
 */
export type FullValidatedNeedsClarification = NeedsClarification & {
  readonly diagnostics: FullDiagnostics;
};

/** What the Engine's validator returns for any {@link PlannerOutput}. */
export type FullValidatedPlannerOutput =
  | FullValidatedCandidate
  | FullValidatedReplylessCandidate
  | FullValidatedNeedsClarification;

/**
 * Whether a planner output is a needs-clarification result rather than a
 * layout candidate. Layout candidates carry no `type` field. The guard checks
 * only the `type` discriminant and does not validate `question` or `options`.
 */
export function isNeedsClarification(
  output: unknown,
): output is NeedsClarification {
  return (
    typeof output === 'object' &&
    output !== null &&
    'type' in output &&
    output.type === 'needs_clarification'
  );
}

type DeepReadonly<T> = T extends
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : { readonly [K in keyof T]: DeepReadonly<T[K]> };
