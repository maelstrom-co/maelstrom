import type { MaelstromResponse } from '@maelstrom-co/protocol';
import type { Store } from '@tanstack/store';

/**
 * Mount-time admission policy shared by every source of user intent.
 * Durations must be finite, positive and at most 2,147,483,647ms; invalid
 * configuration throws at construction. Pending users send only while connected.
 * Deadlines settle tickets without cancelling work or releasing an unresolved turn.
 */
export interface IntentQueueOptions {
  /** Maximum pending users, excluding the active turn. Positive safe integer; default 8. */
  readonly capacity?: number;
  /** Maximum pending wait in milliseconds; default 30,000. */
  readonly maxWaitMs?: number;
  /** Pending connection-loss grace in milliseconds, capped by maxWaitMs; default 10,000. */
  readonly connectionGraceMs?: number;
  /** Active ticket deadline in milliseconds; default 60,000. Does not release an unresolved transport lock. */
  readonly activeTimeoutMs?: number;
}

/** Reasons an intent never reached the engine; these outcomes have no intent side effects. */
export type IntentNotSubmittedReason =
  | 'queue_full'
  | 'queue_expired'
  | 'disconnected'
  | 'disposed'
  | 'connector_replaced'
  | 'owner_retired';

/** Exactly one terminal outcome. Unknown work must not be retried automatically. */
export type IntentResult =
  | {
      /** Response and its atomic layout/action batch completed successfully. */
      readonly status: 'applied';
      /** Engine response applied to the client. */
      readonly response: MaelstromResponse;
    }
  | {
      /** Engine submission never began. */
      readonly status: 'not_submitted';
      /** Stable admission or lifetime refusal. */
      readonly reason: IntentNotSubmittedReason;
    }
  | {
      /** Failed means known pre-side-effect refusal; unknown includes partial application and transport uncertainty. */
      readonly status: 'failed' | 'unknown';
      /** Original error, preserved for authentication/error presentation. */
      readonly error: Error;
    };

/** Observable ticket state; subscribe before reading store.state to avoid missed transitions. */
export type IntentSnapshot =
  | IntentResult
  | {
      /** Queued work has not sent; processing spans sending and atomic command settlement. */
      readonly status: 'queued' | 'processing';
      /** One-based FIFO position when queued, otherwise null. */
      readonly queuePosition: number | null;
    };

/** Synchronous admission decision with a never-rejecting terminal promise. */
export interface IntentSubmission {
  /** Unique within the owning Orchestrator. */
  readonly id: string;
  /** False only for an immediate refusal; accepted work may later expire. */
  readonly accepted: boolean;
  /** Observe state; consumers must not mutate this store. */
  readonly store: Store<IntentSnapshot>;
  /** Resolves exactly once, even on timeout, replacement or disposal. */
  readonly result: Promise<IntentResult>;
}

/** Owner lifetime, not cancellation: retiring never interrupts a dispatched turn. */
export interface IntentScope {
  /** Admit through the same FIFO as unscoped users. */
  enqueueIntent(intent: string): IntentSubmission;
  /** Idempotently retire only pending work; future submissions are refused. */
  retire(): void;
}

/** Optional lifetime for accepted-but-undispatched work. */
export interface EnqueueIntentOptions {
  /** Scope created by this Orchestrator; foreign scopes throw synchronously. */
  readonly scope?: IntentScope;
}

/** Admission authority, distinct from RequestCoordinator's network-only telemetry. */
export interface IntentSchedulerState {
  /** Applying includes settlement of the current atomic response batch. */
  readonly phase: 'idle' | 'sending' | 'applying';
  /** Number of accepted users waiting for dispatch. */
  readonly pendingCount: number;
  /** Maximum pending users, excluding the active turn. */
  readonly capacity: number;
  /** Active queued ticket, or null for immediate/automatic work. */
  readonly currentTicketId: string | null;
}

/** Read-only-by-contract observation surface for shared engine admission. */
export interface IntentSchedulerView {
  /** Subscribe before reading state; consumers must not mutate this store. */
  readonly store: Store<IntentSchedulerState>;
}
