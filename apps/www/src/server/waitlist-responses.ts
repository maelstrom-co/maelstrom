import type { InvalidConfirmToken } from './confirm-request';
import type {
  BodyTooLarge,
  InvalidBody,
  InvalidEmail,
  UnsupportedMediaType,
} from './signup-request';
import type { SignupWorkflowError } from './signup-workflow';
import type { WaitlistRepositoryError } from './waitlist-repository';

const jsonResponse = (value: unknown, status: number): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Confirm responses must never be stored, referred, or indexed. */
export function privateResponse(
  body: BodyInit | null,
  init: ResponseInit,
): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(body, { ...init, headers });
}

export const confirmRedirect = (
  request: Request,
  status: 'confirmed' | 'invalid',
): Response => {
  const target = new URL(`/waitlist/${status}/`, request.url);
  return privateResponse(null, {
    status: 303,
    headers: { Location: target.href },
  });
};

/**
 * Maps a typed signup decode failure onto the previous JSON contract.
 */
export function toSignupDecodeResponse(
  error: UnsupportedMediaType | BodyTooLarge | InvalidBody | InvalidEmail,
): Response {
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
}

/**
 * Maps a typed signup failure onto the exact previous HTTP contract so
 * claimed and suppressed addresses stay indistinguishable at the wire.
 */
export function toSignupFailureResponse(error: SignupWorkflowError): Response {
  switch (error._tag) {
    case 'TurnstileUnavailable':
      return jsonResponse(
        { error: 'Waitlist signup is temporarily unavailable.' },
        503,
      );
    case 'WaitlistPersistenceError':
    case 'DeliveryStateConflict':
      console.error({
        message: 'waitlist signup failed',
        category: 'signup_store_failed',
      });
      return jsonResponse(
        { error: 'Could not start your signup. Please try again.' },
        500,
      );
    case 'TurnstileRejected':
      return jsonResponse(
        { error: 'Security check failed. Please try again.' },
        400,
      );
  }
}

/**
 * Maps a typed confirm decode failure onto the previous private contract.
 */
export function toConfirmDecodeResponse(
  error: UnsupportedMediaType | BodyTooLarge | InvalidConfirmToken,
  request: Request,
): Response {
  switch (error._tag) {
    case 'UnsupportedMediaType':
      return privateResponse('Unsupported media type.', { status: 415 });
    case 'BodyTooLarge':
      return privateResponse('Request body is too large.', { status: 413 });
    case 'InvalidConfirmToken':
      return confirmRedirect(request, 'invalid');
  }
}

/**
 * Maps a typed confirm persistence failure onto the previous 503 contract.
 * A conflict is an outage here, not a security rejection.
 */
export function toConfirmFailureResponse(
  error: WaitlistRepositoryError,
): Response {
  switch (error._tag) {
    case 'WaitlistPersistenceError':
    case 'DeliveryStateConflict':
      console.error({
        message: 'waitlist confirmation failed',
        category: 'confirmation_store_failed',
      });
      return privateResponse(
        'Waitlist confirmation is temporarily unavailable.',
        { status: 503 },
      );
  }
}
