import { describe, expect, test } from 'bun:test';
import {
  CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
  resolveTurnstileSiteKey,
} from './turnstile-site-key';

describe('resolveTurnstileSiteKey', () => {
  test('uses Cloudflare public test configuration outside production', () => {
    expect(resolveTurnstileSiteKey(undefined, 'preview')).toBe(
      CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
    );
    expect(resolveTurnstileSiteKey(undefined, undefined)).toBe(
      CLOUDFLARE_TURNSTILE_TEST_SITE_KEY,
    );
    expect(() => resolveTurnstileSiteKey(undefined, 'prodution')).toThrow(
      'PUBLIC_TURNSTILE_ENVIRONMENT',
    );
  });

  test('requires a managed non-test site key in production', () => {
    expect(
      resolveTurnstileSiteKey('0x4AAAAAAEXK9DFwilhX3Cla', 'production'),
    ).toBe('0x4AAAAAAEXK9DFwilhX3Cla');
    expect(() => resolveTurnstileSiteKey(undefined, 'production')).toThrow(
      'PUBLIC_TURNSTILE_SITE_KEY',
    );
    expect(() =>
      resolveTurnstileSiteKey(CLOUDFLARE_TURNSTILE_TEST_SITE_KEY, 'production'),
    ).toThrow('managed Turnstile site key');
    expect(() => resolveTurnstileSiteKey('not-a-key', 'production')).toThrow(
      'managed Turnstile site key',
    );
  });
});
