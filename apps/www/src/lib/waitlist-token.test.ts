import { describe, expect, test } from 'bun:test';
import {
  createWaitlistToken,
  hashWaitlistToken,
  isWaitlistToken,
} from './waitlist-token';

describe('waitlist confirmation tokens', () => {
  test('creates URL-safe tokens with enough entropy for emailed links', () => {
    const token = createWaitlistToken();
    expect(token).toHaveLength(43);
    expect(isWaitlistToken(token)).toBe(true);
    expect(createWaitlistToken()).not.toBe(token);
  });

  test('rejects malformed tokens before querying D1', () => {
    expect(isWaitlistToken(null)).toBe(false);
    expect(isWaitlistToken('short')).toBe(false);
    expect(isWaitlistToken(`${'a'.repeat(42)}+`)).toBe(false);
  });

  test('hashes tokens deterministically without retaining the token', async () => {
    const token = 'a'.repeat(43);
    const hash = await hashWaitlistToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(await hashWaitlistToken(token)).toBe(hash);
  });
});
