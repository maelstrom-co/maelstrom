import { Context, Effect, Layer } from 'effect';
import * as Result from 'effect/Result';
import { buildWaitlistConfirmationEmail } from '../lib/waitlist-confirmation-email';
import type { ClaimDeliveryAttempt } from '../lib/waitlist-delivery-store';
import { createWaitlistToken, hashWaitlistToken } from '../lib/waitlist-token';
import { readProperty } from './read-property';
import type {
  TurnstileVerifierError,
  TurnstileVerifierService,
} from './turnstile-verifier';
import type {
  WaitlistRepositoryError,
  WaitlistRepositoryService,
} from './waitlist-repository';

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

const DEFINITE_EMAIL_FAILURE_CODES = new Set([
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_TOO_MANY_RECIPIENTS',
  'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_RECIPIENT_SUPPRESSED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_CONTENT_TOO_LARGE',
  'E_DELIVERY_FAILED',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY',
]);
const RETRYABLE_EMAIL_FAILURE_CODES = new Set([
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
]);

/** Delivery work waiting on the background execution context. */
export interface PendingDelivery {
  readonly attemptId: string;
  readonly email: string;
  /** Raw confirmation token — memory-only, never persisted or logged. */
  readonly token: string;
}

/** Outcome of `begin`: a suppressed address or a claimed delivery payload. */
export type SignupBeginResult =
  | { readonly kind: 'suppressed' }
  | ({ readonly kind: 'claimed' } & PendingDelivery);

/** Failures `begin` can raise; delivery swallows every fallible step. */
export type SignupWorkflowError =
  | TurnstileVerifierError
  | WaitlistRepositoryError;

type EmailDisposition = 'rejected' | 'retryable' | 'unknown';

export interface SignupWorkflowService {
  /**
   * Runs verify → hash → durable claim for one signup. Returns whether the
   * address earned a delivery; suppressed addresses answer identically to
   * claimed ones at the transport so signup state is never disclosed.
   */
  readonly begin: (input: {
    readonly email: string;
    readonly turnstileToken: string;
    readonly remoteIp: string | null;
  }) => Effect.Effect<SignupBeginResult, SignupWorkflowError>;

  /**
   * Sends the confirmation email and records the outcome. Never fails
   * outward: it runs on the background execution context, where a rejection
   * would be unlogged.
   */
  readonly deliver: (delivery: PendingDelivery) => Effect.Effect<void, never>;
}

/** Verify → hash → claim, then a never-failing deliver for `waitUntil`. */
export class SignupWorkflow extends Context.Service<
  SignupWorkflow,
  SignupWorkflowService
>()('@maelstrom/www/SignupWorkflow') {
  static readonly layer = (options: {
    readonly verifier: TurnstileVerifierService;
    readonly repository: WaitlistRepositoryService;
    readonly emailService: SendEmail;
    readonly nowIso: () => string;
  }): Layer.Layer<SignupWorkflow, never, never> =>
    Layer.effect(
      SignupWorkflow,
      Effect.gen(function* () {
        const begin = Effect.fn('SignupWorkflow.begin')(function* (input: {
          readonly email: string;
          readonly turnstileToken: string;
          readonly remoteIp: string | null;
        }) {
          yield* options.verifier.verify(input.turnstileToken, input.remoteIp);

          const token = createWaitlistToken();
          const tokenHash = yield* Effect.promise(() =>
            hashWaitlistToken(token),
          );
          const nowIso = options.nowIso();
          const nowMs = Date.parse(nowIso);
          const attemptId = crypto.randomUUID();

          const claim: ClaimDeliveryAttempt = {
            id: attemptId,
            email: input.email,
            tokenHash,
            expiresAt: new Date(nowMs + CONFIRMATION_TTL_MS).toISOString(),
            attemptedAt: nowIso,
            cooldownSince: new Date(nowMs - RESEND_COOLDOWN_MS).toISOString(),
          };
          const claimed = yield* options.repository.claimDeliveryAttempt(claim);
          if (!claimed) return { kind: 'suppressed' as const };

          return {
            kind: 'claimed' as const,
            attemptId,
            email: input.email,
            token,
          };
        });

        const deliver = Effect.fn('SignupWorkflow.deliver')(function* (
          delivery: PendingDelivery,
        ) {
          const sent = yield* Effect.result(
            Effect.tryPromise({
              try: () =>
                options.emailService.send({
                  ...buildWaitlistConfirmationEmail(delivery.token),
                  to: delivery.email,
                }),
              catch: (cause) => cause,
            }),
          );
          if (Result.isFailure(sent)) {
            yield* recordFailure(
              options.repository,
              delivery.attemptId,
              classifyEmailFailure(sent.failure),
              options.nowIso,
            );
            return;
          }
          const result = sent.success;

          if (!result.messageId) {
            yield* recordFailure(
              options.repository,
              delivery.attemptId,
              {
                code: 'unclassified',
                disposition: 'unknown',
              },
              options.nowIso,
            );
            return;
          }

          const accepted = yield* options.repository
            .markAccepted(
              delivery.attemptId,
              result.messageId,
              options.nowIso(),
            )
            .pipe(Effect.result);
          if (Result.isFailure(accepted)) {
            logDeliveryStateFailure(delivery.attemptId);
          }
        });

        return SignupWorkflow.of({ begin, deliver });
      }),
    );
}

const recordFailure = (
  repository: WaitlistRepositoryService,
  attemptId: string,
  failure: {
    readonly code: string;
    readonly disposition: EmailDisposition;
  },
  nowIso: () => string,
) =>
  Effect.gen(function* () {
    const changedAt = nowIso();
    const transition =
      failure.disposition === 'rejected'
        ? repository.markRejected(attemptId, failure.code, changedAt)
        : failure.disposition === 'retryable'
          ? repository.markRetryable(attemptId, failure.code, changedAt)
          : repository.markUnknown(attemptId, failure.code, changedAt);
    const recorded = yield* transition.pipe(Effect.result);
    if (Result.isFailure(recorded)) {
      logDeliveryStateFailure(attemptId);
    }
    console.error({
      message: 'waitlist email attempt failed',
      attemptId,
      category: `email_send_${failure.disposition}`,
      providerCode: failure.code,
    });
  });

function classifyEmailFailure(error: unknown): {
  code: string;
  disposition: EmailDisposition;
} {
  const value = readProperty(error, 'code');
  if (typeof value === 'string' && RETRYABLE_EMAIL_FAILURE_CODES.has(value)) {
    return { code: value, disposition: 'retryable' };
  }
  if (value === 'E_INTERNAL_SERVER_ERROR') {
    return { code: value, disposition: 'unknown' };
  }
  if (typeof value === 'string' && DEFINITE_EMAIL_FAILURE_CODES.has(value)) {
    return { code: value, disposition: 'rejected' };
  }
  return { code: 'unclassified', disposition: 'unknown' };
}

function logDeliveryStateFailure(attemptId: string): void {
  console.error({
    message: 'waitlist delivery state update failed',
    attemptId,
    category: 'delivery_state_update_failed',
  });
}
