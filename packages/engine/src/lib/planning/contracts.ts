import type {
  ActionExecution,
  ChartRequest,
  GridLayout,
  LayoutMode,
  MessageId,
  Result,
  SessionId,
  TilingLayout,
  UpdateReason,
} from '@maelstrom-co/protocol';

import type { LLMContextMessage } from '../history/history-manager.js';

/** A detached enum value available to a planner for one action parameter. */
export interface NormalizedActionEnumEntry {
  /** Vessel that declares the action. */
  readonly vesselId: string;
  /** Variant that exposes the action. */
  readonly variant: string;
  /** Action that owns the parameter. */
  readonly action: string;
  /** Parameter constrained by these values. */
  readonly parameter: string;
  /** Detached, recursively frozen JSON candidates. */
  readonly values: readonly unknown[];
}

/** Immutable request and context shared by every invocation in one operation. */
export interface PlanningInput {
  /** Validated, detached, recursively frozen chart request. */
  readonly request: ChartRequest;
  /** Provider-neutral structured and conversational history snapshots. */
  readonly history: {
    /** Structured accepted plans. Reserved for planner implementations. */
    readonly structured: readonly PlanningHistoryEntry[];
    /** Existing role-tagged conversational projection for LLM planners. */
    readonly conversation: readonly LLMContextMessage[];
  };
  /** Stable action enum snapshot. */
  readonly actionEnums: readonly NormalizedActionEnumEntry[];
}

/**
 * Accepted planning context retained for a future planner. These entries record
 * accepted plans, not evidence that a client executed them.
 */
export type PlanningHistoryEntry =
  | {
      /** A finalized chart_request and the plan accepted for it. */
      readonly kind: 'turn';
      /** Correlation id from the accepted request. */
      readonly id: MessageId;
      /** Session that owns this accepted plan. */
      readonly sessionId: SessionId;
      /** Client-supplied request timestamp. */
      readonly timestamp: number;
      /** Reasons that caused the accepted planning operation. */
      readonly updateReasons: readonly UpdateReason[];
      /** Finalized layout selected by the engine. */
      readonly layout: GridLayout | TilingLayout;
      /** Finalized ordered actions selected by the engine. */
      readonly executionPlan: readonly ActionExecution[];
      /** Optional user-facing prose supplied with the accepted plan. */
      readonly userMessage?: string;
      /** Optional diagnostic prose supplied with the accepted plan. */
      readonly rationale?: string;
    }
  | {
      /** A developer-supplied assistant injection. */
      readonly kind: 'injection';
      /** Correlation id for the injection. */
      readonly id: MessageId;
      /** Session that owns the injection. */
      readonly sessionId: SessionId;
      /** Client-supplied injection timestamp. */
      readonly timestamp: number;
      /** Assistant content supplied by the developer. */
      readonly content: string;
    };

/** One public action proposal with decoded JSON-object parameters. */
export interface PlannerActionCandidate {
  /** Target instance identity. */
  readonly instanceId: unknown;
  /** Requested action identity. */
  readonly action: unknown;
  /** Decoded JSON-object parameters, omitted for parameterless actions. */
  readonly params?: unknown;
}

/** Untrusted provider proposal. The finalizer owns all canonical parsing. */
export interface PlannerCandidate {
  /** Proposed layout in the mode-specific protocol JSON representation. */
  readonly layout: unknown;
  /** Ordered actions using {@link PlannerActionCandidate}. */
  readonly executionPlan: readonly PlannerActionCandidate[];
  /** Optional user-facing text for presentation. */
  readonly userMessage?: unknown;
  /** Optional diagnostic rationale. */
  readonly rationale?: unknown;
  /** True when a conventional LLM response must retain legacy prose validation. */
  readonly requiresPresentation?: boolean;
}

/** Why a planner chose not to produce a candidate. */
export type PlanningDeferralReason =
  | 'unsupported_capability'
  | 'invalid_plan'
  | 'uncertain'
  | 'policy';

/** Candidate or semantic deferral returned by a planner. */
export type PlannerProposal =
  | { readonly kind: 'candidate'; readonly candidate: PlannerCandidate }
  | {
      readonly kind: 'deferred';
      readonly reason: PlanningDeferralReason;
      readonly detail?: Readonly<Record<string, string | number | boolean>>;
    };

/** Stable, bounded identity details that make a repair issue actionable. */
export interface FinalizationIssueLocation {
  /** Proposal action index when the issue concerns an action. */
  readonly actionIndex?: number;
  /** Proposal tree token index when the issue concerns a tiling tree. */
  readonly tokenIndex?: number;
  /** Proposed instance identity when it is safe and available. */
  readonly instanceId?: string;
  /** Proposed action identity when it is safe and available. */
  readonly action?: string;
  /** Proposed parameter identity when it is safe and available. */
  readonly parameter?: string;
  /** Bounded canonical schema path for malformed candidate data. */
  readonly path?: readonly (string | number)[];
  /** Specific parameter validation kinds when parameters were rejected. */
  readonly parameterIssueKinds?: readonly string[];
}

/** Bounded machine-readable finalization issue. */
export interface FinalizationIssue {
  /** Broad finalization stage. */
  readonly kind: 'candidate' | 'layout' | 'action' | 'text';
  /** Stable reason from the candidate parser, layout healer, or action parser. */
  readonly code: string;
  /** Safe bounded human-readable detail. */
  readonly message: string;
  /** Safe identity and location details for a repair planner. */
  readonly location?: FinalizationIssueLocation;
}

/** Public feedback from canonical finalization for a repair invocation. */
export interface FinalizationReport {
  /** First bounded actionable issues in proposal order. */
  readonly issues: readonly FinalizationIssue[];
  /** Number of additional issues omitted from the bounded list. */
  readonly omittedIssueCount: number;
  /** Whether finalization produced a renderable layout and action plan. */
  readonly renderable: boolean;
  /** Whether legacy heal-and-ship policy recommends another attempt. */
  readonly retryRecommended: boolean;
}

/** Candidate attached to a repair phase. */
export interface PreviousPlannerCandidate extends PlannerCandidate {}

/** One initial or repair planner invocation. */
export interface PlannerInvocation {
  /** Immutable operation input shared by primary, repairs, and fallback. */
  readonly input: PlanningInput;
  /** Initial invocation or bounded repair feedback. */
  readonly phase:
    | { readonly kind: 'initial' }
    | {
        readonly kind: 'repair';
        readonly number: number;
        readonly previous: PreviousPlannerCandidate;
        readonly report: FinalizationReport;
      };
  /** Cancellation, deadline, and logical-call accounting. */
  readonly context: PlanningOperationContext;
}

/** Shared operation control supplied to every planner invocation. */
export interface PlanningOperationContext {
  /** Aborts for caller cancellation or the whole-operation deadline. */
  readonly signal: AbortSignal;
  /** Absolute operation deadline, omitted when deadlines are disabled. */
  readonly deadlineAt?: number;
  /** Shared logical provider-call budget. */
  readonly calls: PlanningCallBudget;
}

/** Synchronous logical-provider call accounting. */
export interface PlanningCallBudget {
  /** Calls not yet claimed by started planner-visible provider work. */
  readonly remaining: number;
  /** Claims one non-refundable logical provider invocation. */
  claim(call: {
    /** Planner starting provider work. */
    readonly plannerId: string;
    /** Planner-local stage name for diagnostics. */
    readonly stage: string;
  }): Result<void, { readonly kind: 'budget_exhausted' }>;
}

/** A planner invocation failure distinct from semantic deferral. */
export interface PlannerFailure {
  /** Failure category used by engine fallback and outward mapping. */
  readonly kind:
    | 'provider_error'
    | 'invalid_provider_response'
    | 'cancelled'
    | 'timeout'
    | 'budget_exhausted'
    | 'validation_error';
  /** Safe failure message. */
  readonly message: string;
  /** Original cause where available. */
  readonly cause?: unknown;
}

/** Provider-neutral planning implementation. */
export interface Planner {
  /** Stable implementation identifier used in call-budget diagnostics. */
  readonly id: string;
  /** Layout modes this implementation can plan without a provider call. */
  readonly supportedLayoutModes: readonly LayoutMode[];
  /** Executes exactly one planner invocation. */
  invoke(
    invocation: PlannerInvocation,
  ): Promise<Result<PlannerProposal, PlannerFailure>>;
}
