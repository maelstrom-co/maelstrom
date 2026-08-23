export const prerender = false;

import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { Effect, Layer } from 'effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { buildWaitlistConfirmationEmail } from '../../lib/waitlist-confirmation-email';
import { WaitlistDeliveryStore } from '../../lib/waitlist-delivery-store';
import {
  createWaitlistToken,
  hashWaitlistToken,
} from '../../lib/waitlist-token';
import { readProperty } from '../../server/read-property';
import { runOrErrorResponse } from '../../server/run-or-error';
import {
  decodeSignupRequest,
  requireTurnstileToken,
} from '../../server/signup-request';
import {
  TurnstileVerifier,
  type TurnstileVerifierError,
} from '../../server/turnstile-verifier';
import {
  makeRepository,
  type WaitlistRepositoryService,
} from '../../server/waitlist-repository';

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
export const POST: APIRoute = async ({ request, locals }) => {
  const decoded = await runOrErrorResponse(
    decodeSignupRequest(request),
    (error) => {
      switch (error._tag) {
        case 'UnsupportedMediaType':
          return jsonResponse({ error: 'Unsupported media type' }, 415);
        case 'BodyTooLarge':
          return jsonResponse({ error: 'Request body is too large' }, 413);
        case 'InvalidBody':
          return jsonResponse({ error: 'Invalid request body' }, 400);
        case 'InvalidEmail':
          return jsonResponse({ error: error.error }, 400);
      }
    },
  );
  if (decoded instanceof Response) return decoded;
  const { email } = decoded;

  const database = env.WAITLIST_DB;
  const emailService = env.EMAIL;
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  if (!database || !emailService || !turnstileSecret) {
    return new Response(
      JSON.stringify({ error: 'Waitlist signup is temporarily unavailable.' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const tokenResult = await runOrErrorResponse(
    requireTurnstileToken(decoded.turnstileToken),
    () => jsonResponse({ error: 'Security check failed.' }, 400),
  );
  if (tokenResult instanceof Response) return tokenResult;
  const turnstileToken = tokenResult;

  const verification = await runOrErrorResponse(
    Effect.gen(function* () {
      const verifier = yield* TurnstileVerifier;
      return yield* verifier.verify(
        turnstileToken,
        request.headers.get('CF-Connecting-IP'),
      );
    }).pipe(
      Effect.provide(
        TurnstileVerifier.layer({ secret: turnstileSecret }).pipe(
          Layer.provide(FetchHttpClient.layer),
        ),
      ),
    ),
    toTurnstileResponse,
  );
  if (verification instanceof Response) return verification;

  const token = createWaitlistToken();
  const tokenHash = await hashWaitlistToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString();
  const cooldown = new Date(now.getTime() - RESEND_COOLDOWN_MS).toISOString();
  const attemptId = crypto.randomUUID();
  const deliveries = makeRepository(new WaitlistDeliveryStore(database));

  const claim = await runOrErrorResponse(
    deliveries.claimDeliveryAttempt({
      id: attemptId,
      email,
      tokenHash,
      expiresAt,
      attemptedAt: nowIso,
      cooldownSince: cooldown,
    }),
    () => {
      console.error({
        message: 'waitlist signup failed',
        category: 'signup_store_failed',
      });
      return jsonResponse(
        { error: 'Could not start your signup. Please try again.' },
        500,
      );
    },
  );
  if (claim instanceof Response) return claim;
  if (!claim) {
    return acceptedResponse();
  }
  {
    const delivery = deliverConfirmationEmail({
      attemptId,
      deliveries,
      email,
      emailService,
      token,
    });
    if (locals?.cfContext) {
      locals.cfContext.waitUntil(delivery);
    } else {
      await delivery;
    }
    return acceptedResponse();
  }
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Runs one server effect and converts its typed failure into a Response at
 * this transport boundary, so handlers stay thin decision tables.
 */
function toTurnstileResponse(error: TurnstileVerifierError): Response {
  if (error._tag === 'TurnstileUnavailable') {
    return jsonResponse(
      { error: 'Waitlist signup is temporarily unavailable.' },
      503,
    );
  }
  return jsonResponse(
    { error: 'Security check failed. Please try again.' },
    400,
  );
}

function acceptedResponse(): Response {
  return jsonResponse({ success: true }, 202);
}

async function deliverConfirmationEmail(input: {
  attemptId: string;
  deliveries: WaitlistRepositoryService;
  email: string;
  emailService: SendEmail;
  token: string;
}): Promise<void> {
  let result: EmailSendResult;
  try {
    result = await input.emailService.send({
      ...buildWaitlistConfirmationEmail(input.token),
      to: input.email,
    });
  } catch (error) {
    const failure = classifyEmailFailure(error);
    await recordEmailFailure(input.deliveries, input.attemptId, failure);
    return;
  }

  if (!result.messageId) {
    await recordEmailFailure(input.deliveries, input.attemptId, {
      code: 'unclassified',
      disposition: 'unknown',
    });
    return;
  }

  const accepted = await Effect.runPromiseExit(
    input.deliveries.markAccepted(
      input.attemptId,
      result.messageId,
      new Date().toISOString(),
    ),
  );
  if (accepted._tag === 'Failure') logDeliveryStateFailure(input.attemptId);
}

function classifyEmailFailure(error: unknown): {
  code: string;
  disposition: 'rejected' | 'retryable' | 'unknown';
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

async function recordEmailFailure(
  deliveries: WaitlistRepositoryService,
  attemptId: string,
  failure: {
    code: string;
    disposition: 'rejected' | 'retryable' | 'unknown';
  },
): Promise<void> {
  const changedAt = new Date().toISOString();
  const transition =
    failure.disposition === 'rejected'
      ? deliveries.markRejected(attemptId, failure.code, changedAt)
      : failure.disposition === 'retryable'
        ? deliveries.markRetryable(attemptId, failure.code, changedAt)
        : deliveries.markUnknown(attemptId, failure.code, changedAt);
  const recorded = await Effect.runPromiseExit(transition);
  if (recorded._tag === 'Failure') logDeliveryStateFailure(attemptId);
  console.error({
    message: 'waitlist email attempt failed',
    attemptId,
    category: `email_send_${failure.disposition}`,
    providerCode: failure.code,
  });
}

function logDeliveryStateFailure(attemptId: string): void {
  console.error({
    message: 'waitlist delivery state update failed',
    attemptId,
    category: 'delivery_state_update_failed',
  });
}
