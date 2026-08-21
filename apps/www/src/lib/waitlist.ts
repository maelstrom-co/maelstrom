// Email validation for the waitlist signup, kept pure so it can be unit-tested
// without the Worker runtime.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const WAITLIST_TURNSTILE_SITE_KEY = '0x4AAAAAAEXK9DFwilhX3Cla';

export type WaitlistEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

export function validateWaitlistEmail(body: unknown): WaitlistEmailResult {
  const email = (body as { email?: unknown } | null)?.email;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'A valid email is required' };
  }
  return { ok: true, email: email.toLowerCase() };
}

export type WaitlistSubmitResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * POST the email to the waitlist API and classify the outcome into a
 * user-facing result. `fetch` is injected so the network-vs-server error
 * branching can be unit-tested without a DOM or real network.
 */
export async function submitWaitlist(
  email: string,
  turnstileToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WaitlistSubmitResult> {
  try {
    const res = await fetchImpl('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstileToken }),
    });
    if (!res.ok) {
      let message = 'Something went wrong';
      try {
        const data: { error?: string } = await res.json();
        if (data.error) message = data.error;
      } catch {
        // Response wasn't JSON (e.g. a 502 HTML page) — keep the default.
      }
      return { ok: false, message };
    }
    return { ok: true };
  } catch (err) {
    // fetch rejects with a TypeError on network failure (offline, DNS, CORS);
    // anything else is unexpected.
    return {
      ok: false,
      message:
        err instanceof TypeError
          ? 'Network error — check your connection and try again.'
          : 'Something went wrong',
    };
  }
}
