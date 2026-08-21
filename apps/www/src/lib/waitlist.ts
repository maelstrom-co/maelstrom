// Email validation for the waitlist signup, kept pure so it can be unit-tested
// without the Worker runtime.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WaitlistEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

export function validateWaitlistEmail(body: unknown): WaitlistEmailResult {
  const value = (body as { email?: unknown } | null)?.email;
  if (typeof value !== 'string') {
    return { ok: false, error: 'A valid email is required' };
  }
  const email = value.trim().toLowerCase();
  const domain = email.slice(email.lastIndexOf('@') + 1);
  const hasValidDomainLabels = domain
    .split('.')
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (
    new TextEncoder().encode(email).byteLength > 254 ||
    !EMAIL_RE.test(email) ||
    !hasValidDomainLabels
  ) {
    return { ok: false, error: 'A valid email is required' };
  }
  return { ok: true, email };
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
