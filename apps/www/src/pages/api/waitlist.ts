export const prerender = false;

import { env } from 'cloudflare:workers';
import {
  isWaitlistProductionHostname,
  WAITLIST_TURNSTILE_ACTION,
} from '@maelstrom-co/platform-infra/waitlist-contract';
import type { APIRoute } from 'astro';
import { readLimitedBody } from '../../lib/read-limited-body';
import { validateWaitlistEmail } from '../../lib/waitlist';
import { buildWaitlistConfirmationEmail } from '../../lib/waitlist-confirmation-email';
import { WaitlistDeliveryStore } from '../../lib/waitlist-delivery-store';
import {
  createWaitlistToken,
  hashWaitlistToken,
} from '../../lib/waitlist-token';

const CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const TURNSTILE_ERROR_CODES = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'missing-input-response',
  'invalid-input-response',
  'bad-request',
  'timeout-or-duplicate',
  'internal-error',
]);
const TURNSTILE_UNAVAILABLE_CODES = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'missing-input-response',
  'bad-request',
  'internal-error',
]);
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
  const body = await readJsonBody(request);
  if (!body.ok) {
    return new Response(JSON.stringify({ error: body.error }), {
      status: body.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const validation = validateWaitlistEmail(body.value);
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const email = validation.email;
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

  const turnstileToken = readTurnstileToken(body.value);
  if (!turnstileToken) {
    return new Response(JSON.stringify({ error: 'Security check failed.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const turnstile = await verifyTurnstile(
    turnstileToken,
    turnstileSecret,
    request.headers.get('CF-Connecting-IP'),
  );
  if (!turnstile.ok) {
    return new Response(
      JSON.stringify({
        error: turnstile.unavailable
          ? 'Waitlist signup is temporarily unavailable.'
          : 'Security check failed. Please try again.',
      }),
      {
        status: turnstile.unavailable ? 503 : 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const token = createWaitlistToken();
  const tokenHash = await hashWaitlistToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString();
  const cooldown = new Date(now.getTime() - RESEND_COOLDOWN_MS).toISOString();
  const attemptId = crypto.randomUUID();
  const deliveries = new WaitlistDeliveryStore(database);

  try {
    const claimed = await deliveries.claimDeliveryAttempt({
      id: attemptId,
      email,
      tokenHash,
      expiresAt,
      attemptedAt: nowIso,
      cooldownSince: cooldown,
    });
    if (!claimed) {
      return acceptedResponse();
    }

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
  } catch {
    console.error({
      message: 'waitlist signup failed',
      category: 'signup_store_failed',
    });
    return new Response(
      JSON.stringify({
        error: 'Could not start your signup. Please try again.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function acceptedResponse(): Response {
  return jsonResponse({ success: true }, 202);
}

async function deliverConfirmationEmail(input: {
  attemptId: string;
  deliveries: WaitlistDeliveryStore;
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

  try {
    await input.deliveries.markAccepted(
      input.attemptId,
      result.messageId,
      new Date().toISOString(),
    );
  } catch {
    logDeliveryStateFailure(input.attemptId);
  }
}

async function readJsonBody(
  request: Request,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string }
> {
  const mediaType = request.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    return { ok: false, status: 415, error: 'Unsupported media type' };
  }

  const body = await readLimitedBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.tooLarge
      ? { ok: false, status: 413, error: 'Request body is too large' }
      : { ok: false, status: 400, error: 'Invalid request body' };
  }

  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid request body' };
  }
}

function readTurnstileToken(body: unknown): string | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('turnstileToken' in body)
  ) {
    return null;
  }
  const token = Reflect.get(body, 'turnstileToken');
  return typeof token === 'string' && token.length <= 2048 ? token : null;
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
  deliveries: WaitlistDeliveryStore,
  attemptId: string,
  failure: {
    code: string;
    disposition: 'rejected' | 'retryable' | 'unknown';
  },
): Promise<void> {
  try {
    if (failure.disposition === 'rejected') {
      await deliveries.markRejected(
        attemptId,
        failure.code,
        new Date().toISOString(),
      );
    } else if (failure.disposition === 'retryable') {
      await deliveries.markRetryable(
        attemptId,
        failure.code,
        new Date().toISOString(),
      );
    } else {
      await deliveries.markUnknown(
        attemptId,
        failure.code,
        new Date().toISOString(),
      );
    }
  } catch {
    logDeliveryStateFailure(attemptId);
  }
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

async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; unavailable: boolean }> {
  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          response: token,
          ...(remoteIp ? { remoteip: remoteIp } : {}),
        }),
      },
    );
    if (!response.ok) {
      logTurnstileFailure('provider_http');
      return { ok: false, unavailable: true };
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      logTurnstileFailure('provider_response');
      return { ok: false, unavailable: true };
    }
    const success = readProperty(result, 'success');
    const action = readProperty(result, 'action');
    const hostname = readProperty(result, 'hostname');
    if (success !== true) {
      const providerCodes = readTurnstileProviderCodes(result);
      const unavailable = providerCodes.some((code) =>
        TURNSTILE_UNAVAILABLE_CODES.has(code),
      );
      logTurnstileFailure(
        unavailable ? 'provider_unavailable' : 'challenge_rejected',
        result,
      );
      return { ok: false, unavailable };
    }
    if (action !== WAITLIST_TURNSTILE_ACTION) {
      logTurnstileFailure('action_mismatch', result);
      return { ok: false, unavailable: false };
    }
    if (
      typeof hostname !== 'string' ||
      !isWaitlistProductionHostname(hostname)
    ) {
      logTurnstileFailure('hostname_mismatch', result);
      return { ok: false, unavailable: false };
    }
    return { ok: true };
  } catch (error) {
    logTurnstileFailure(
      error instanceof DOMException && error.name === 'TimeoutError'
        ? 'request_timeout'
        : 'request_failed',
    );
    return { ok: false, unavailable: true };
  }
}

function logTurnstileFailure(category: string, result?: unknown): void {
  console.error({
    message: 'waitlist Turnstile verification failed',
    category,
    providerCodes: readTurnstileProviderCodes(result),
  });
}

function readTurnstileProviderCodes(result: unknown): string[] {
  const codes = readProperty(result, 'error-codes');
  return Array.isArray(codes)
    ? [
        ...new Set(
          codes.filter(
            (code): code is string =>
              typeof code === 'string' && TURNSTILE_ERROR_CODES.has(code),
          ),
        ),
      ]
    : [];
}

function readProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined;
}
