import { describe, expect, test } from 'bun:test';
import { parsePublishedVersion } from './registry.ts';

describe('parsePublishedVersion', () => {
  const registry = 'https://npm.pkg.github.com';

  test('recognizes the immutable version returned by the registry', () => {
    expect(
      parsePublishedVersion(
        '"0.2.0-alpha.1"\n',
        '@maelstrom-co/react',
        '0.2.0-alpha.1',
        registry,
      ),
    ).toBe(true);
  });

  test('treats GitHub Packages empty success response as unpublished', () => {
    expect(
      parsePublishedVersion(
        '',
        '@maelstrom-co/react',
        '0.2.0-alpha.1',
        registry,
      ),
    ).toBe(false);
  });

  test('rejects an unexpected version instead of skipping a required publish', () => {
    expect(() =>
      parsePublishedVersion(
        '"0.2.0-alpha.0"',
        '@maelstrom-co/react',
        '0.2.0-alpha.1',
        registry,
      ),
    ).toThrow('Refusing to guess');
  });
});
