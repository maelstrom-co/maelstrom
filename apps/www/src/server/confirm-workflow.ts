import { Context, Effect, Layer } from 'effect';
import * as Result from 'effect/Result';
import { buildWaitlistInvitationEmail } from '../lib/waitlist-invitation-email';
import { createWaitlistToken, hashWaitlistToken } from '../lib/waitlist-token';
import {
  WaitlistRepository,
  type WaitlistRepositoryError,
} from './waitlist-repository';

const ACCESS_RECEIPT_TTL_MS = 60 * 60 * 1000;

/** Outcome of `begin`: a live confirm with a memory-only receipt, or invalid. */
export type ConfirmBeginResult =
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'confirmed';
      readonly email: string;
      /** Raw access receipt — memory-only, never persisted or logged. */
      readonly receipt: string;
    };

export interface ConfirmWorkflowService {
  /**
   * Hashes the confirmation token, mints a one-hour receipt, and claims the
   * pending→confirmed transition. The raw receipt stays in memory for the
   * cookie; only hashes reach persistence.
   */
  readonly begin: (input: {
    readonly token: string;
  }) => Effect.Effect<ConfirmBeginResult, WaitlistRepositoryError>;

  /**
   * Sends the Discord invitation. Never fails outward: it runs on the
   * background execution context, where a rejection would be unlogged.
   */
  readonly deliver: (delivery: {
    readonly email: string;
  }) => Effect.Effect<void, never>;
}

/** Hash → mint receipt → confirm; invitation send is a later deliver. */
export class ConfirmWorkflow extends Context.Service<
  ConfirmWorkflow,
  ConfirmWorkflowService
>()('@maelstrom/www/ConfirmWorkflow') {
  /** Context injection keeps the repository's scoped D1 client live for each workflow execution. */
  static readonly layer = (options: {
    readonly emailService?: SendEmail;
    readonly nowIso: () => string;
  }): Layer.Layer<ConfirmWorkflow, never, WaitlistRepository> =>
    Layer.effect(
      ConfirmWorkflow,
      Effect.gen(function* () {
        const repository = yield* WaitlistRepository;
        const begin = Effect.fn('ConfirmWorkflow.begin')(function* (input: {
          readonly token: string;
        }) {
          const tokenHash = yield* Effect.promise(() =>
            hashWaitlistToken(input.token),
          );
          const receipt = createWaitlistToken();
          const receiptHash = yield* Effect.promise(() =>
            hashWaitlistToken(receipt),
          );
          const nowIso = options.nowIso();
          const nowMs = Date.parse(nowIso);
          const confirmed = yield* repository.confirmToken(tokenHash, nowIso, {
            hash: receiptHash,
            expiresAt: new Date(nowMs + ACCESS_RECEIPT_TTL_MS).toISOString(),
          });
          if (!confirmed) return { kind: 'invalid' as const };
          return {
            kind: 'confirmed' as const,
            email: confirmed.email,
            receipt,
          };
        });

        const deliver = Effect.fn('ConfirmWorkflow.deliver')(
          function* (delivery: { readonly email: string }) {
            const emailService = options.emailService;
            if (!emailService) {
              console.error({
                message: 'waitlist invitation email failed',
                category: 'invitation_email_unavailable',
              });
              return;
            }
            const sent = yield* Effect.result(
              Effect.tryPromise({
                try: () =>
                  emailService.send({
                    ...buildWaitlistInvitationEmail(),
                    to: delivery.email,
                  }),
                catch: () => undefined,
              }),
            );
            if (Result.isFailure(sent) || !sent.success.messageId) {
              console.error({
                message: 'waitlist invitation email failed',
                category: 'invitation_email_failed',
              });
            }
          },
        );

        return ConfirmWorkflow.of({ begin, deliver });
      }),
    );
}
