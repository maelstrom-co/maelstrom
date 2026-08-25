import { Context, Effect, Layer } from 'effect';
import * as Result from 'effect/Result';
import { buildWaitlistInvitationEmail } from '../lib/waitlist-invitation-email';
import {
  classifyEmailFailure,
  type EmailDisposition,
} from './waitlist-email-failure';
import {
  WaitlistRepository,
  type WaitlistRepositoryError,
  type WaitlistRepositoryService,
} from './waitlist-repository';

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

/** Claimed resend identity retained only for server-side delivery. */
export interface PendingResendDelivery {
  /** Durable resend attempt identifier. */
  readonly attemptId: string;
  /** Normalized delivery address; never logged or returned by the route. */
  readonly email: string;
}

/** Outcome of a generic confirmed-subscriber resend claim. */
export type WaitlistResendBeginResult =
  | { readonly kind: 'suppressed' }
  | ({ readonly kind: 'claimed' } & PendingResendDelivery);

export interface WaitlistResendWorkflowService {
  /** Claims a confirmed resend without disclosing why an address was suppressed. */
  readonly begin: (
    email: string,
  ) => Effect.Effect<WaitlistResendBeginResult, WaitlistRepositoryError>;

  /** Sends and settles one claimed resend; expected failures never reject outward. */
  readonly deliver: (
    delivery: PendingResendDelivery,
  ) => Effect.Effect<void, never>;
}

export class WaitlistResendWorkflow extends Context.Service<
  WaitlistResendWorkflow,
  WaitlistResendWorkflowService
>()('@maelstrom/www/WaitlistResendWorkflow') {
  /** Context injection keeps the repository's scoped D1 client live for each workflow execution. */
  static readonly layer = (options: {
    readonly emailService: SendEmail;
    readonly nowIso: () => string;
  }): Layer.Layer<WaitlistResendWorkflow, never, WaitlistRepository> =>
    Layer.effect(
      WaitlistResendWorkflow,
      Effect.gen(function* () {
        const repository = yield* WaitlistRepository;
        const begin = Effect.fn('WaitlistResendWorkflow.begin')(function* (
          email: string,
        ) {
          const attemptedAt = options.nowIso();
          const attemptId = crypto.randomUUID();
          const claimed = yield* repository.claimResendAttempt({
            id: attemptId,
            email,
            attemptedAt,
            cooldownSince: new Date(
              Date.parse(attemptedAt) - RESEND_COOLDOWN_MS,
            ).toISOString(),
          });
          if (!claimed) return { kind: 'suppressed' as const };
          return {
            kind: 'claimed' as const,
            attemptId,
            email,
          };
        });

        const deliver = Effect.fn('WaitlistResendWorkflow.deliver')(function* (
          delivery: PendingResendDelivery,
        ) {
          const sent = yield* Effect.tryPromise({
            try: () =>
              options.emailService.send({
                ...buildWaitlistInvitationEmail(),
                to: delivery.email,
              }),
            catch: (cause) => cause,
          }).pipe(Effect.result);

          if (Result.isFailure(sent)) {
            yield* settleFailure(
              repository,
              delivery.attemptId,
              classifyEmailFailure(sent.failure),
              options.nowIso(),
            );
            return;
          }
          if (!sent.success.messageId) {
            yield* settleFailure(
              repository,
              delivery.attemptId,
              { code: 'unclassified', disposition: 'unknown' },
              options.nowIso(),
            );
            return;
          }

          const settled = yield* repository
            .markResendAccepted(
              delivery.attemptId,
              sent.success.messageId,
              options.nowIso(),
            )
            .pipe(Effect.result);
          if (Result.isFailure(settled))
            logResendFailure('state_update_failed');
        });

        return WaitlistResendWorkflow.of({ begin, deliver });
      }),
    );
}

const settleFailure = (
  repository: WaitlistRepositoryService,
  attemptId: string,
  failure: { code: string; disposition: EmailDisposition },
  changedAt: string,
) =>
  Effect.gen(function* () {
    const transition =
      failure.disposition === 'rejected'
        ? repository.markResendRejected(attemptId, failure.code, changedAt)
        : failure.disposition === 'retryable'
          ? repository.markResendRetryable(attemptId, failure.code, changedAt)
          : repository.markResendUnknown(attemptId, failure.code, changedAt);
    const settled = yield* transition.pipe(Effect.result);
    logResendFailure(
      Result.isFailure(settled)
        ? 'state_update_failed'
        : `email_send_${failure.disposition}`,
    );
  });

function logResendFailure(category: string): void {
  console.error({ message: 'waitlist resend failed', category });
}
