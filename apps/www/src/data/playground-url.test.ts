import { describe, expect, test } from 'bun:test';

import { resolvePlaygroundUrl } from './playground-url';

describe('resolvePlaygroundUrl', () => {
  test('uses the production Playground when no override is configured', () => {
    expect(resolvePlaygroundUrl(undefined, undefined)).toBe(
      'https://demo.maelstrom-ai.co',
    );
  });

  test('preserves a valid override exactly', () => {
    const override = 'https://example.invalid/maelstrom-playground-pr-123/';

    expect(resolvePlaygroundUrl(override, 'preview')).toBe(override);
  });

  test('requires an override in preview', () => {
    expect(() => resolvePlaygroundUrl(undefined, 'preview')).toThrow(
      'PUBLIC_PLAYGROUND_URL is required when CLOUDFLARE_ENV=preview',
    );
  });

  test.each([
    ['malformed URL outside preview', 'not a URL', undefined],
    ['malformed URL in preview', 'not a URL', 'preview'],
    ['HTTPS URL without an authority', 'https:example.invalid', undefined],
    ['HTTP URL outside preview', 'http://example.invalid', undefined],
    ['HTTP URL in preview', 'http://example.invalid', 'preview'],
    [
      'credential-bearing HTTPS URL outside preview',
      'https://user:pass@example.invalid',
      undefined,
    ],
    [
      'credential-bearing HTTPS URL in preview',
      'https://user:pass@example.invalid',
      'preview',
    ],
  ])('rejects a %s', (_case, override, environment) => {
    expect(() => resolvePlaygroundUrl(override, environment)).toThrow(
      'PUBLIC_PLAYGROUND_URL must be an absolute HTTPS URL without credentials',
    );
  });
});
