import { Context, Data, Effect, Layer } from 'effect';
import {
  type ClaimDeliveryAttempt,
  type ClaimResendAttempt,
  DeliveryStateConflictError,
  WaitlistDeliveryStore,
} from '../lib/waitlist-delivery-store';

/** One-time receipt stored atomically with the confirmed transition. */
export interface AccessReceipt {
  readonly hash: string;
  readonly expiresAt: string;
}

/** The confirmed subscriber identity needed by downstream delivery work. */
export interface ConfirmedSignup {
  readonly email: string;
}

/** Persistence operations that can fail; names appear in typed errors. */
export type WaitlistOperation =
  | 'claimDeliveryAttempt'
  | 'claimResendAttempt'
  | 'markAccepted'
  | 'markRejected'
  | 'markUnknown'
  | 'markRetryable'
  | 'markResendAccepted'
  | 'markResendRejected'
  | 'markResendUnknown'
  | 'markResendRetryable'
  | 'confirmToken'
  | 'hasValidAccessReceipt';

/**
 * Persistence failed the way an outage does. Carries only the operation
 * name — raw D1 causes can contain provider payloads and must not reach
 * callers or logs.
 */
export class WaitlistPersistenceError extends Data.TaggedError(
  'WaitlistPersistenceError',
)<{
  readonly operation: WaitlistOperation;
}> {}

/**
 * The attempt is missing, already in a different settled state, or has
 * conflicting provider metadata. An exact idempotent repeat returns
 * successfully from the store instead; do not treat this tag as success.
 */
export class DeliveryStateConflict extends Data.TaggedError(
  'DeliveryStateConflict',
)<Record<string, never>> {}

/** Everything persistence can fail with, across all repository calls. */
export type WaitlistRepositoryError =
  | WaitlistPersistenceError
  | DeliveryStateConflict;

/** D1-backed waitlist persistence behind typed errors. */
export interface WaitlistRepositoryService {
  readonly claimDeliveryAttempt: (
    input: ClaimDeliveryAttempt,
  ) => Effect.Effect<boolean, WaitlistRepositoryError>;

  readonly claimResendAttempt: (
    input: ClaimResendAttempt,
  ) => Effect.Effect<boolean, WaitlistRepositoryError>;

  readonly markAccepted: (
    id: string,
    messageId: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  readonly markRejected: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  readonly markUnknown: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  readonly markRetryable: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  readonly markResendAccepted: (
    id: string,
    messageId: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  readonly markResendRejected: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  readonly markResendUnknown: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  readonly markResendRetryable: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  readonly confirmToken: (
    tokenHash: string,
    now: string,
    receipt?: AccessReceipt,
  ) => Effect.Effect<ConfirmedSignup | null, WaitlistRepositoryError>;

  readonly hasValidAccessReceipt: (
    receiptHash: string,
    now: string,
  ) => Effect.Effect<boolean, WaitlistRepositoryError>;
}

export class WaitlistRepository extends Context.Service<
  WaitlistRepository,
  WaitlistRepositoryService
>()('@maelstrom/www/WaitlistRepository') {
  /**
   * Builds the repository over one D1 binding. The store owns all SQL; this
   * seam adds typed failures so workflows can branch on conflict versus
   * outage without knowing either SQL or D1 error shapes.
   */
  static readonly layer = (
    database: D1Database,
  ): Layer.Layer<WaitlistRepository> =>
    Layer.succeed(
      WaitlistRepository,
      makeRepository(new WaitlistDeliveryStore(database)),
    );
}

/** Builds the service over a store; tests supply recording doubles. */
export const makeRepository = (
  store: WaitlistDeliveryStore,
): WaitlistRepositoryService => ({
  claimDeliveryAttempt: (input) =>
    persist('claimDeliveryAttempt', () => store.claimDeliveryAttempt(input)),

  claimResendAttempt: (input) =>
    persist('claimResendAttempt', () => store.claimResendAttempt(input)),

  markAccepted: (id, messageId, changedAt) =>
    persist('markAccepted', () => store.markAccepted(id, messageId, changedAt)),

  markRejected: (id, failureCode, changedAt) =>
    persist('markRejected', () =>
      store.markRejected(id, failureCode, changedAt),
    ),

  markUnknown: (id, failureCode, changedAt) =>
    persist('markUnknown', () => store.markUnknown(id, failureCode, changedAt)),

  markRetryable: (id, failureCode, changedAt) =>
    persist('markRetryable', () =>
      store.markRetryable(id, failureCode, changedAt),
    ),

  markResendAccepted: (id, messageId, changedAt) =>
    persist('markResendAccepted', () =>
      store.markResendAccepted(id, messageId, changedAt),
    ),

  markResendRejected: (id, failureCode, changedAt) =>
    persist('markResendRejected', () =>
      store.markResendRejected(id, failureCode, changedAt),
    ),

  markResendUnknown: (id, failureCode, changedAt) =>
    persist('markResendUnknown', () =>
      store.markResendUnknown(id, failureCode, changedAt),
    ),

  markResendRetryable: (id, failureCode, changedAt) =>
    persist('markResendRetryable', () =>
      store.markResendRetryable(id, failureCode, changedAt),
    ),

  confirmToken: (tokenHash, now, receipt) =>
    persist('confirmToken', () => store.confirmToken(tokenHash, now, receipt)),

  hasValidAccessReceipt: (receiptHash, now) =>
    persist('hasValidAccessReceipt', () =>
      store.hasValidAccessReceipt(receiptHash, now),
    ),
});

const persist = <A>(
  operation: WaitlistOperation,
  run: () => Promise<A>,
): Effect.Effect<A, WaitlistRepositoryError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      cause instanceof DeliveryStateConflictError
        ? new DeliveryStateConflict({})
        : new WaitlistPersistenceError({ operation }),
  });
