import * as D1Client from '@effect/sql-d1/D1Client';
import {
  waitlistConfirmationDeliveries,
  waitlistDeliveryBackoffs,
  waitlistRelations,
  waitlistResendDeliveries,
  waitlistSubscribers,
} from '@maelstrom-co/platform-infra/waitlist-schema';
import {
  and,
  eq,
  exists,
  gt,
  inArray,
  notExists,
  notInArray,
  sql,
} from 'drizzle-orm';
import * as DrizzleD1 from 'drizzle-orm/effect-d1';
import { Context, Data, Effect, Layer } from 'effect';

const EMAIL_RETRY_BACKOFF_MS = 10 * 60 * 1000;
const EMAIL_DAILY_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

/** Input for an atomic pending-subscriber confirmation delivery claim. */
export interface ClaimDeliveryAttempt {
  /** Idempotency key for this delivery attempt. */
  readonly id: string;
  /** Case-insensitive subscriber key after input normalization. */
  readonly email: string;
  /** Raw confirmation tokens never enter persistence. */
  readonly tokenHash: string;
  /** Canonical ISO timestamp with an exclusive boundary. */
  readonly expiresAt: string;
  /** Canonical ISO timestamp used for ordering and backoff comparisons. */
  readonly attemptedAt: string;
  /** Attempts exactly on this boundary remain eligible. */
  readonly cooldownSince: string;
}

/** Input for an atomic confirmed-subscriber resend claim. */
export interface ClaimResendAttempt {
  /** Idempotency key for this resend attempt. */
  readonly id: string;
  /** Case-insensitive confirmed-subscriber key. */
  readonly email: string;
  /** Canonical ISO timestamp used for ordering and backoff comparisons. */
  readonly attemptedAt: string;
  /** Attempts exactly on this boundary remain eligible. */
  readonly cooldownSince: string;
}

/** One-time receipt stored atomically with the confirmed transition. */
export interface AccessReceipt {
  /** Raw receipt values never enter persistence. */
  readonly hash: string;
  /** Canonical ISO timestamp with an exclusive boundary. */
  readonly expiresAt: string;
}

/** The confirmed subscriber identity needed by downstream delivery work. */
export interface ConfirmedSignup {
  /** Case-insensitive subscriber key returned only for a new confirmation. */
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
type RetryEvidence = 'state-and-failure' | 'state-failure-and-changed-at';

/** D1-backed waitlist persistence behind typed errors. */
export interface WaitlistRepositoryService {
  /** Returns false without revealing which eligibility rule denied the claim. */
  readonly claimDeliveryAttempt: (
    input: ClaimDeliveryAttempt,
  ) => Effect.Effect<boolean, WaitlistRepositoryError>;

  /** Returns false for unknown, ineligible, and cooling-down addresses alike. */
  readonly claimResendAttempt: (
    input: ClaimResendAttempt,
  ) => Effect.Effect<boolean, WaitlistRepositoryError>;

  /** Exact replays succeed without rewriting settlement time. */
  readonly markAccepted: (
    id: string,
    messageId: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  /** Exact replays succeed without rewriting settlement time. */
  readonly markRejected: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  /** Exact replays succeed without rewriting settlement time. */
  readonly markUnknown: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  /** Matching replays preserve the legacy ability to extend max backoff. */
  readonly markRetryable: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  /** Exact replays succeed without rewriting settlement time. */
  readonly markResendAccepted: (
    id: string,
    messageId: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  /** Exact replays succeed without rewriting settlement time. */
  readonly markResendRejected: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  /** Exact replays succeed without rewriting settlement time. */
  readonly markResendUnknown: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  /** Matching replays never extend the original provider backoff. */
  readonly markResendRetryable: (
    id: string,
    failureCode: string,
    changedAt: string,
  ) => Effect.Effect<void, WaitlistRepositoryError>;

  /** Returns email only for a new confirmation; receipt writes are atomic. */
  readonly confirmToken: (
    tokenHash: string,
    now: string,
    receipt?: AccessReceipt,
  ) => Effect.Effect<ConfirmedSignup | null, WaitlistRepositoryError>;

  /** Expiry is exclusive. */
  readonly hasValidAccessReceipt: (
    receiptHash: string,
    now: string,
  ) => Effect.Effect<boolean, WaitlistRepositoryError>;
}

/** Owns the scoped D1 client used by one consuming Effect. */
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
        const compileBatchStatement = (query: {
          toSQL(): { readonly sql: string; readonly params: unknown[] };
        }) => {
          const compiled = query.toSQL();
          return db.$client.unsafe<Record<string, unknown>>(
            compiled.sql,
            compiled.params,
          );
        };
        const activeEmailProviderBackoff = (attemptedAt: string) =>
          db
            .select({ provider: waitlistDeliveryBackoffs.provider })
            .from(waitlistDeliveryBackoffs)
            .where(
              and(
                eq(waitlistDeliveryBackoffs.provider, 'email'),
                gt(waitlistDeliveryBackoffs.retryAfter, attemptedAt),
              ),
            );

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
        const retryableTransition = Effect.fn(
          'WaitlistRepository.retryableTransition',
        )(function* (
          table: TransitionTable,
          operation: 'markRetryable' | 'markResendRetryable',
          backoffEvidence: RetryEvidence,
          id: string,
          failureCode: string,
          changedAt: string,
        ) {
          const changedTime = Date.parse(changedAt);
          if (
            !Number.isFinite(changedTime) ||
            new Date(changedTime).toISOString() !== changedAt
          ) {
            return yield* new WaitlistPersistenceError({ operation });
          }
          const backoffMs =
            failureCode === 'E_DAILY_LIMIT_EXCEEDED'
              ? EMAIL_DAILY_LIMIT_BACKOFF_MS
              : EMAIL_RETRY_BACKOFF_MS;
          const retryAfter = new Date(changedTime + backoffMs).toISOString();
          const transition = db
            .update(table)
            .set({
              state: 'retryable',
              stateChangedAt: changedAt,
              providerMessageId: null,
              failureCode,
            })
            .where(and(eq(table.id, id), eq(table.state, 'attempting')))
            .returning({ state: table.state });
          const matchingRetry = db
            .select({
              provider: sql<string>`'email'`.as('provider'),
              retryAfter: sql<string>`${retryAfter}`.as('retry_after'),
              failureCode: sql<string>`${failureCode}`.as('failure_code'),
              updatedAt: sql<string>`${changedAt}`.as('updated_at'),
            })
            .from(table)
            .where(
              and(
                eq(table.id, id),
                eq(table.state, 'retryable'),
                eq(table.failureCode, failureCode),
                backoffEvidence === 'state-failure-and-changed-at'
                  ? eq(table.stateChangedAt, changedAt)
                  : undefined,
              ),
            );
          const providerBackoff = db
            .insert(
              waitlistDeliveryBackoffs,
              'provider',
              'retryAfter',
              'failureCode',
              'updatedAt',
            )
            .select(matchingRetry)
            .onConflictDoUpdate({
              target: waitlistDeliveryBackoffs.provider,
              set: {
                retryAfter: sql`max(${waitlistDeliveryBackoffs.retryAfter}, ${retryAfter})`,
                failureCode,
                updatedAt: changedAt,
              },
            });

          // Effect SQL cannot transact on D1; its native batch is the atomic
          // boundary for the state transition and provider-wide backoff.
          const [updated] = yield* db.$client
            .batch([
              compileBatchStatement(transition),
              compileBatchStatement(providerBackoff),
            ])
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
            current[0]?.state === 'retryable' &&
            current[0].providerMessageId === null &&
            current[0].failureCode === failureCode
          ) {
            return;
          }
          return yield* new DeliveryStateConflict({});
        });

        return WaitlistRepository.of({
          claimDeliveryAttempt: Effect.fn(
            'WaitlistRepository.claimDeliveryAttempt',
          )(function* (input) {
            yield* db
              .insert(waitlistSubscribers)
              .values({
                email: input.email,
                status: 'pending',
                updatedAt: input.attemptedAt,
              })
              .onConflictDoNothing()
              .pipe(persistQuery('claimDeliveryAttempt'));

            const recentDelivery = db
              .select({ id: waitlistConfirmationDeliveries.id })
              .from(waitlistConfirmationDeliveries)
              .where(
                and(
                  eq(
                    waitlistConfirmationDeliveries.email,
                    waitlistSubscribers.email,
                  ),
                  notInArray(waitlistConfirmationDeliveries.state, [
                    'rejected',
                    'retryable',
                  ]),
                  gt(
                    waitlistConfirmationDeliveries.attemptedAt,
                    input.cooldownSince,
                  ),
                ),
              );
            const eligibleSubscriber = db
              .select({
                id: sql<string>`${input.id}`.as('id'),
                email: waitlistSubscribers.email,
                tokenHash: sql<string>`${input.tokenHash}`.as('token_hash'),
                expiresAt: sql<string>`${input.expiresAt}`.as('expires_at'),
                state: sql<string>`'attempting'`.as('state'),
                attemptedAt: sql<string>`${input.attemptedAt}`.as(
                  'attempted_at',
                ),
                stateChangedAt: sql<string>`${input.attemptedAt}`.as(
                  'state_changed_at',
                ),
              })
              .from(waitlistSubscribers)
              .where(
                and(
                  eq(waitlistSubscribers.email, input.email),
                  eq(waitlistSubscribers.status, 'pending'),
                  notExists(activeEmailProviderBackoff(input.attemptedAt)),
                  notExists(recentDelivery),
                ),
              );
            const inserted = yield* db
              .insert(
                waitlistConfirmationDeliveries,
                'id',
                'email',
                'tokenHash',
                'expiresAt',
                'state',
                'attemptedAt',
                'stateChangedAt',
              )
              .select(eligibleSubscriber)
              .returning({ id: waitlistConfirmationDeliveries.id })
              .pipe(persistQuery('claimDeliveryAttempt'));
            return inserted.length > 0;
          }),
          claimResendAttempt: Effect.fn(
            'WaitlistRepository.claimResendAttempt',
          )(function* (input) {
            const recentDelivery = db
              .select({ id: waitlistResendDeliveries.id })
              .from(waitlistResendDeliveries)
              .where(
                and(
                  eq(waitlistResendDeliveries.email, waitlistSubscribers.email),
                  gt(waitlistResendDeliveries.attemptedAt, input.cooldownSince),
                ),
              );
            const eligibleSubscriber = db
              .select({
                id: sql<string>`${input.id}`.as('id'),
                email: waitlistSubscribers.email,
                state: sql<string>`'attempting'`.as('state'),
                attemptedAt: sql<string>`${input.attemptedAt}`.as(
                  'attempted_at',
                ),
                stateChangedAt: sql<string>`${input.attemptedAt}`.as(
                  'state_changed_at',
                ),
              })
              .from(waitlistSubscribers)
              .where(
                and(
                  eq(waitlistSubscribers.email, input.email),
                  eq(waitlistSubscribers.status, 'confirmed'),
                  notExists(activeEmailProviderBackoff(input.attemptedAt)),
                  notExists(recentDelivery),
                ),
              );
            const inserted = yield* db
              .insert(
                waitlistResendDeliveries,
                'id',
                'email',
                'state',
                'attemptedAt',
                'stateChangedAt',
              )
              .select(eligibleSubscriber)
              .returning({ id: waitlistResendDeliveries.id })
              .pipe(persistQuery('claimResendAttempt'));
            return inserted.length > 0;
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
              return yield* retryableTransition(
                waitlistConfirmationDeliveries,
                'markRetryable',
                'state-and-failure',
                id,
                failureCode,
                changedAt,
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
            return yield* retryableTransition(
              waitlistResendDeliveries,
              'markResendRetryable',
              'state-failure-and-changed-at',
              id,
              failureCode,
              changedAt,
            );
          }),
          confirmToken: Effect.fn('WaitlistRepository.confirmToken')(
            function* (tokenHash, now, receipt) {
              const pendingSubscriber = db
                .select({ email: waitlistSubscribers.email })
                .from(waitlistSubscribers)
                .where(
                  and(
                    eq(
                      waitlistSubscribers.email,
                      waitlistConfirmationDeliveries.email,
                    ),
                    eq(waitlistSubscribers.status, 'pending'),
                  ),
                );
              const acceptAttempt = db
                .update(waitlistConfirmationDeliveries)
                .set({
                  state: 'accepted',
                  stateChangedAt: now,
                  failureCode: null,
                })
                .where(
                  and(
                    eq(waitlistConfirmationDeliveries.tokenHash, tokenHash),
                    gt(waitlistConfirmationDeliveries.expiresAt, now),
                    inArray(waitlistConfirmationDeliveries.state, [
                      'attempting',
                      'accepted',
                      'unknown',
                    ]),
                    exists(pendingSubscriber),
                  ),
                );
              const acceptedAttempt = db
                .select({ email: waitlistConfirmationDeliveries.email })
                .from(waitlistConfirmationDeliveries)
                .where(
                  and(
                    eq(waitlistConfirmationDeliveries.tokenHash, tokenHash),
                    gt(waitlistConfirmationDeliveries.expiresAt, now),
                    eq(waitlistConfirmationDeliveries.state, 'accepted'),
                  ),
                );
              const confirmSubscriber = db
                .update(waitlistSubscribers)
                .set({
                  status: 'confirmed',
                  confirmationTokenHash: null,
                  confirmationExpiresAt: null,
                  confirmationSentAt: null,
                  confirmedAt: now,
                  updatedAt: now,
                  ...(receipt
                    ? {
                        accessReceiptHash: receipt.hash,
                        accessReceiptExpiresAt: receipt.expiresAt,
                      }
                    : {}),
                })
                .where(
                  and(
                    eq(waitlistSubscribers.status, 'pending'),
                    inArray(waitlistSubscribers.email, acceptedAttempt),
                  ),
                )
                .returning({ email: waitlistSubscribers.email });

              // Receipt fields belong to the subscriber update so a used token
              // cannot attach a receipt in a later batch statement.
              const [, confirmation] = yield* db.$client
                .batch([
                  compileBatchStatement(acceptAttempt),
                  compileBatchStatement(confirmSubscriber),
                ])
                .pipe(persistQuery('confirmToken'));
              if (confirmation === undefined) {
                return yield* new WaitlistPersistenceError({
                  operation: 'confirmToken',
                });
              }
              const confirmed = confirmation[0];
              if (confirmed === undefined) return null;
              if (typeof confirmed.email !== 'string') {
                return yield* new WaitlistPersistenceError({
                  operation: 'confirmToken',
                });
              }
              return { email: confirmed.email };
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

const persistQuery = (operation: WaitlistOperation) =>
  Effect.mapError(() => new WaitlistPersistenceError({ operation }));
