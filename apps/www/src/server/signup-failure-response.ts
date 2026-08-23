import type { SignupWorkflowError } from './signup-workflow';

const jsonResponse = (value: unknown, status: number): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

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
