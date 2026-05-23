// Email validation for the waitlist signup, kept pure (no cloudflare:workers /
// Resend imports) so it can be unit-tested without the worker runtime.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WaitlistEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

export function validateWaitlistEmail(body: unknown): WaitlistEmailResult {
  const email = (body as { email?: unknown } | null)?.email;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'A valid email is required' };
  }
  return { ok: true, email };
}
