import { describe, expect, it } from 'bun:test';
import { submitWaitlist, validateWaitlistEmail } from './waitlist';

describe('validateWaitlistEmail', () => {
  it('accepts a well-formed email', () => {
    expect(validateWaitlistEmail({ email: 'user@example.com' })).toEqual({
      ok: true,
      email: 'user@example.com',
    });
  });

  it('normalizes case before using an address as a D1 identity', () => {
    expect(validateWaitlistEmail({ email: 'User@Example.COM' })).toEqual({
      ok: true,
      email: 'user@example.com',
    });
  });

  it('trims surrounding whitespace before using an address as a D1 identity', () => {
    expect(validateWaitlistEmail({ email: '  User@Example.COM\n' })).toEqual({
      ok: true,
      email: 'user@example.com',
    });
  });

  it('rejects an address beyond the practical mailbox limit', () => {
    expect(
      validateWaitlistEmail({ email: `${'a'.repeat(243)}@example.com` }).ok,
    ).toBe(false);
  });

  for (const email of [
    'user@-example.com',
    'user@example-.com',
    `user@${'a'.repeat(64)}.com`,
  ]) {
    it(`rejects invalid domain labels: ${JSON.stringify(email)}`, () => {
      expect(validateWaitlistEmail({ email }).ok).toBe(false);
    });
  }

  // Each must stay rejected: a regression here lets junk into Resend, so the
  // cases pin the exact contract the route depends on.
  const INVALID = [
    '', // empty
    'not-an-email', // no @
    'a@b', // no dot in domain
    'a b@c.com', // whitespace in local part
    'a@b.', // nothing after the dot
    '@b.com', // empty local part
    'user@.com', // empty domain label
    'user@@example.com', // double @
  ];
  for (const email of INVALID) {
    it(`rejects invalid email: ${JSON.stringify(email)}`, () => {
      expect(validateWaitlistEmail({ email }).ok).toBe(false);
    });
  }

  it('rejects a missing email field', () => {
    expect(validateWaitlistEmail({}).ok).toBe(false);
  });

  it('rejects a non-string email', () => {
    expect(validateWaitlistEmail({ email: 123 }).ok).toBe(false);
    expect(validateWaitlistEmail({ email: null }).ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateWaitlistEmail(null).ok).toBe(false);
    expect(validateWaitlistEmail('user@example.com').ok).toBe(false);
  });
});

describe('submitWaitlist', () => {
  const fetchResolving = (res: Partial<Response>): typeof fetch =>
    (async () => res) as unknown as typeof fetch;
  const fetchRejecting = (err: unknown): typeof fetch =>
    (async () => {
      throw err;
    }) as unknown as typeof fetch;

  it('returns ok on a 2xx response', async () => {
    expect(
      await submitWaitlist(
        'a@b.co',
        'turnstile-token',
        fetchResolving({ ok: true }),
      ),
    ).toEqual({ ok: true });
  });

  // The user-facing message is the contract; these pin each branch so a
  // regression that shows the wrong message is caught.
  it('surfaces the server error message from a JSON error body', async () => {
    const res = await submitWaitlist(
      'a@b.co',
      'turnstile-token',
      fetchResolving({
        ok: false,
        json: async () => ({ error: 'Already in' }),
      }),
    );
    expect(res).toEqual({ ok: false, message: 'Already in' });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    const res = await submitWaitlist(
      'a@b.co',
      'turnstile-token',
      fetchResolving({
        ok: false,
        json: async () => {
          throw new SyntaxError('not json');
        },
      }),
    );
    expect(res).toEqual({ ok: false, message: 'Something went wrong' });
  });

  it('classifies a fetch TypeError as a network error', async () => {
    const res = await submitWaitlist(
      'a@b.co',
      'turnstile-token',
      fetchRejecting(new TypeError('Failed to fetch')),
    );
    expect(res).toEqual({
      ok: false,
      message: 'Network error — check your connection and try again.',
    });
  });

  it('treats a non-TypeError rejection as a generic failure', async () => {
    const res = await submitWaitlist(
      'a@b.co',
      'turnstile-token',
      fetchRejecting(new Error('x')),
    );
    expect(res).toEqual({ ok: false, message: 'Something went wrong' });
  });
});
