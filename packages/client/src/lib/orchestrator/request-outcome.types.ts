import type { ActionName, InstanceId } from '@maelstrom-co/protocol';
import type { Store } from '@tanstack/store';

import type { IntentNotSubmittedReason } from './intent-scheduler.types.js';

/** Identity of one Action planned by the Engine for a request. */
export interface RequestActionTarget {
  /** Instance the Action targets. */
  readonly instanceId: InstanceId;
  /** Action name as planned by the Engine. */
  readonly action: ActionName;
  /** Planned Action parameters, omitted for a parameterless invocation. */
  readonly params?: Record<string, unknown>;
}

/**
 * Outcome of one planned Action within the requesting operation's own batch.
 * Only this request's Action execution contributes; Actions run by other
 * requests or invoked directly by the application never appear here.
 */
export type RequestActionOutcome = RequestActionTarget &
  (
    | {
        /** Planned and not yet settled. */
        readonly status: 'pending';
      }
    | {
        /** The handler succeeded, or the Action had no effect to run. */
        readonly status: 'ran';
        /** Short note the handler returned on success, when it returned one. */
        readonly note?: string;
      }
    | {
        /** The handler reported an error or threw. */
        readonly status: 'failed';
        /** Error message reported by the handler. */
        readonly reason: string;
      }
    | {
        /** The Action did not run. */
        readonly status: 'skipped';
        /** Why the Action did not run. */
        readonly reason: string;
      }
    | {
        /**
         * No result was recorded for the Action before the batch settled.
         * It may or may not have taken effect; do not replay it automatically.
         */
        readonly status: 'unknown';
      }
  );

/** Status of a request, following its ticket from admission to its terminal result. */
export type RequestOutcomeStatus =
  | 'queued'
  | 'processing'
  | 'applied'
  | 'failed'
  | 'unknown'
  | 'not_submitted';

/**
 * Outcome of one submitted intent, describing only that request's own settled
 * response batch. Global idleness and transport completion never settle it.
 */
export interface RequestOutcome {
  /** Ticket id of the submission, equal to `IntentSubmission.id`. */
  readonly id: string;
  /** Natural-language intent as submitted. */
  readonly intent: string;
  /**
   * `applied` means the response and every planned Action completed.
   * `failed` means a known refusal before any side effect.
   * `unknown` covers partial application, Action failures and transport
   * uncertainty; it is never a claim that nothing happened.
   * `not_submitted` means the intent never reached the Engine.
   */
  readonly status: RequestOutcomeStatus;
  /**
   * One entry per Action in the response's Execution Plan, in plan order, which
   * preserves each Instance's Action order. Empty until a response is about to
   * be applied, and stays empty when no response was applied.
   */
  readonly actions: readonly RequestActionOutcome[];
  /** Admission or lifetime refusal, present only when `status` is `not_submitted`. */
  readonly reason?: IntentNotSubmittedReason;
  /** Original error, present only when `status` is `failed` or `unknown`. */
  readonly error?: Error;
}

/**
 * Recent request outcomes keyed by ticket id. Only the most recently admitted
 * {@link REQUEST_OUTCOME_RETENTION} requests are retained; older entries are
 * dropped in admission order.
 */
export interface RequestOutcomesState {
  /** Retained outcomes keyed by ticket id. */
  readonly outcomes: Readonly<Record<string, RequestOutcome>>;
  /** Ticket id of the most recently admitted accepted request, or null before one. */
  readonly latestId: string | null;
}

/** Read-only-by-contract observation surface for per-request outcomes. */
export interface RequestOutcomeView {
  /** Subscribe before reading state; consumers must not mutate this store. */
  readonly store: Store<RequestOutcomesState>;
}

/** Number of most recently admitted requests whose outcomes are retained. */
export const REQUEST_OUTCOME_RETENTION = 50;
