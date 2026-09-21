import type {
  GridResponse,
  MaelstromResponse,
  TilingResponse,
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
 */
export type PlannerCandidate = GridResponse | TilingResponse;

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
