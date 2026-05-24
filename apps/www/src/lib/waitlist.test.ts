import { describe, expect, it } from 'bun:test';
import { validateWaitlistEmail } from './waitlist';

describe('validateWaitlistEmail', () => {
  it('accepts a well-formed email', () => {
    expect(validateWaitlistEmail({ email: 'user@example.com' })).toEqual({
      ok: true,
      email: 'user@example.com',
    });
  });

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
