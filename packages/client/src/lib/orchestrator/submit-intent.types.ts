import type { AgentInputSource } from '@maelstrom-co/protocol';

import type { SettledAgentRun } from './agent-run-state.js';
import type { AgentMessageSubmission } from './conversation-event.types.js';
import type {
  IntentResult,
  IntentScope,
  IntentSubmission,
} from './intent-scheduler.types.js';

/**
 * Route used by {@link Orchestrator.submit} and default voice submissions.
 *
 * - `'single-request'`: submits through the bounded FIFO intent queue
 *   ({@link Orchestrator.enqueueIntent}).
 * - `'agent'`: submits through the Agent Session conversation
 *   ({@link Orchestrator.sendMessage}).
 */
export type IntentRoute = 'single-request' | 'agent';

/**
 * Default {@link IntentRoute} applied when `intentRoute` is omitted from
 * Orchestrator configuration.
 */
export const DEFAULT_INTENT_ROUTE: IntentRoute = 'single-request';

/** How the user produced an intent submitted through {@link Orchestrator.submit}. */
export type IntentSubmitSource = AgentInputSource;

/** Options for {@link Orchestrator.submit}. */
export interface SubmitIntentOptions {
  /** How the user produced the intent. Defaults to `'text'`. */
  readonly source?: IntentSubmitSource;
  /**
   * Optional owner lifetime for pending work on the `'single-request'` route.
   * Ignored on the `'agent'` route. A scope created by another Orchestrator
   * throws synchronously on the `'single-request'` route.
   */
  readonly scope?: IntentScope;
}

/**
 * Synchronous handle returned by {@link Orchestrator.submit}, discriminated
 * by the configured {@link IntentRoute}.
 *
 * `result` settles exactly once and never rejects. Unknown outcomes
 * (`status: 'unknown'` on `'single-request'`, `status: 'lost'` on `'agent'`)
 * do not prove that no side effect occurred and must not be replayed
 * automatically.
 */
export type SubmittedIntent =
  | {
      /** Route that handled this submission. */
      readonly route: 'single-request';
      /** Source that produced this submission. */
      readonly source: IntentSubmitSource;
      /** Underlying single-request FIFO ticket. */
      readonly submission: IntentSubmission;
      /** False only for an immediate refusal; accepted work may still settle `not_submitted`. */
      readonly accepted: boolean;
      /** Settles once with the single-request terminal outcome; never rejects. */
      readonly result: Promise<IntentResult>;
    }
  | {
      /** Route that handled this submission. */
      readonly route: 'agent';
      /** Source that produced this submission. */
      readonly source: IntentSubmitSource;
      /** Underlying agent message submission. */
      readonly submission: AgentMessageSubmission;
      /**
       * False only when the submission was refused before being handed to the
       * connector (Orchestrator disposed or not connected). Accepted work may
       * still settle `not_submitted`, for example when the connector cannot
       * carry agent inputs.
       */
      readonly accepted: boolean;
      /** Settles once with the settled Agent Run state; never rejects. */
      readonly result: Promise<SettledAgentRun>;
    };
