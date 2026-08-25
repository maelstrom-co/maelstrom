import * as D1Client from '@effect/sql-d1/D1Client';
import {
  waitlistConfirmationDeliveries,
  waitlistRelations,
  waitlistResendDeliveries,
  waitlistSubscribers,
} from '@maelstrom-co/platform-infra/waitlist-schema';
import { and, eq, gt } from 'drizzle-orm';
import * as DrizzleD1 from 'drizzle-orm/effect-d1';
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

type TransitionTable =
  | typeof waitlistConfirmationDeliveries
  | typeof waitlistResendDeliveries;
type TransitionState = 'accepted' | 'rejected' | 'unknown';
type ConfirmationTransitionOperation =
  | 'markAccepted'
  | 'markRejected'
  | 'markUnknown';
type ResendTransitionOperation =
  | 'markResendAccepted'
  | 'markResendRejected'
  | 'markResendUnknown';
type TransitionOperation =
  | ConfirmationTransitionOperation
  | ResendTransitionOperation;
type Transition<TOperation extends TransitionOperation> = (
  operation: TOperation,
  id: string,
  state: TransitionState,
  changedAt: string,
  providerMessageId: string | null,
  failureCode: string | null,
) => Effect.Effect<void, WaitlistRepositoryError>;

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
   * Keeps the scoped D1 client and prepared-statement cache live until the
   * consuming Effect completes, then finalizes both.
   */
  static readonly layer = (
    database: D1Database,
  ): Layer.Layer<WaitlistRepository> =>
    Layer.effect(
      WaitlistRepository,
      Effect.gen(function* () {
        const db = yield* DrizzleD1.makeWithDefaults({
          relations: waitlistRelations,
        });
        const store = new WaitlistDeliveryStore(database);

        function makeTransition(
          table: typeof waitlistConfirmationDeliveries,
          effectName: 'WaitlistRepository.confirmationTransition',
        ): Transition<ConfirmationTransitionOperation>;
        function makeTransition(
          table: typeof waitlistResendDeliveries,
          effectName: 'WaitlistRepository.resendTransition',
        ): Transition<ResendTransitionOperation>;
        function makeTransition(table: TransitionTable, effectName: string) {
          return Effect.fn(effectName)(function* (
            operation: TransitionOperation,
            id: string,
            state: TransitionState,
            changedAt: string,
            providerMessageId: string | null,
            failureCode: string | null,
          ) {
            const updated = yield* db
              .update(table)
              .set({
                state,
                stateChangedAt: changedAt,
                providerMessageId,
                failureCode,
              })
              .where(and(eq(table.id, id), eq(table.state, 'attempting')))
              .returning({ id: table.id })
              .pipe(persistQuery(operation));
            if (updated.length > 0) return;

            const current = yield* db
              .select({
                state: table.state,
                providerMessageId: table.providerMessageId,
                failureCode: table.failureCode,
              })
              .from(table)
              .where(eq(table.id, id))
              .limit(1)
              .pipe(persistQuery(operation));
            if (
              current[0]?.state === state &&
              current[0].providerMessageId === providerMessageId &&
              current[0].failureCode === failureCode
            ) {
              return;
            }
            return yield* new DeliveryStateConflict({});
          });
        }

        const confirmationTransition = makeTransition(
          waitlistConfirmationDeliveries,
          'WaitlistRepository.confirmationTransition',
        );
        const resendTransition = makeTransition(
          waitlistResendDeliveries,
          'WaitlistRepository.resendTransition',
        );

        return WaitlistRepository.of({
          claimDeliveryAttempt: Effect.fn(
            'WaitlistRepository.claimDeliveryAttempt',
          )(function* (input) {
            return yield* persistRaw('claimDeliveryAttempt', () =>
              store.claimDeliveryAttempt(input),
            );
          }),
          claimResendAttempt: Effect.fn(
            'WaitlistRepository.claimResendAttempt',
          )(function* (input) {
            return yield* persistRaw('claimResendAttempt', () =>
              store.claimResendAttempt(input),
            );
          }),
          markAccepted: Effect.fn('WaitlistRepository.markAccepted')(
            function* (id, messageId, changedAt) {
              return yield* confirmationTransition(
                'markAccepted',
                id,
                'accepted',
                changedAt,
                messageId,
                null,
              );
            },
          ),
          markRejected: Effect.fn('WaitlistRepository.markRejected')(
            function* (id, failureCode, changedAt) {
              return yield* confirmationTransition(
                'markRejected',
                id,
                'rejected',
                changedAt,
                null,
                failureCode,
              );
            },
          ),
          markUnknown: Effect.fn('WaitlistRepository.markUnknown')(
            function* (id, failureCode, changedAt) {
              return yield* confirmationTransition(
                'markUnknown',
                id,
                'unknown',
                changedAt,
                null,
                failureCode,
              );
            },
          ),
          markRetryable: Effect.fn('WaitlistRepository.markRetryable')(
            function* (id, failureCode, changedAt) {
              return yield* persistRaw('markRetryable', () =>
                store.markRetryable(id, failureCode, changedAt),
              );
            },
          ),
          markResendAccepted: Effect.fn(
            'WaitlistRepository.markResendAccepted',
          )(function* (id, messageId, changedAt) {
            return yield* resendTransition(
              'markResendAccepted',
              id,
              'accepted',
              changedAt,
              messageId,
              null,
            );
          }),
          markResendRejected: Effect.fn(
            'WaitlistRepository.markResendRejected',
          )(function* (id, failureCode, changedAt) {
            return yield* resendTransition(
              'markResendRejected',
              id,
              'rejected',
              changedAt,
              null,
              failureCode,
            );
          }),
          markResendUnknown: Effect.fn('WaitlistRepository.markResendUnknown')(
            function* (id, failureCode, changedAt) {
              return yield* resendTransition(
                'markResendUnknown',
                id,
                'unknown',
                changedAt,
                null,
                failureCode,
              );
            },
          ),
          markResendRetryable: Effect.fn(
            'WaitlistRepository.markResendRetryable',
          )(function* (id, failureCode, changedAt) {
            return yield* persistRaw('markResendRetryable', () =>
              store.markResendRetryable(id, failureCode, changedAt),
            );
          }),
          confirmToken: Effect.fn('WaitlistRepository.confirmToken')(
            function* (tokenHash, now, receipt) {
              return yield* persistRaw('confirmToken', () =>
                store.confirmToken(tokenHash, now, receipt),
              );
            },
          ),
          hasValidAccessReceipt: Effect.fn(
            'WaitlistRepository.hasValidAccessReceipt',
          )(function* (receiptHash, now) {
            const matches = yield* db
              .select({ email: waitlistSubscribers.email })
              .from(waitlistSubscribers)
              .where(
                and(
                  eq(waitlistSubscribers.accessReceiptHash, receiptHash),
                  gt(waitlistSubscribers.accessReceiptExpiresAt, now),
                ),
              )
              .limit(1)
              .pipe(persistQuery('hasValidAccessReceipt'));
            return matches.length > 0;
          }),
        });
      }),
    ).pipe(Layer.provide(D1Client.layer({ db: database }).pipe(Layer.orDie)));
}

const persistRaw = <A>(
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

const persistQuery = (operation: WaitlistOperation) =>
  Effect.mapError(() => new WaitlistPersistenceError({ operation }));
