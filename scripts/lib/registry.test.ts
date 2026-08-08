import { describe, expect, test } from 'bun:test';
import {
  authenticationFailureHint,
  parsePublishedVersion,
  shouldTreatNotFoundAsUnpublished,
} from './registry.ts';

describe('shouldTreatNotFoundAsUnpublished', () => {
  const notFound = 'npm error code E404\nnpm error 404 Not Found';

  test('rejects ambiguous 404 responses from private GitHub Packages', () => {
    expect(
      shouldTreatNotFoundAsUnpublished(notFound, 'https://npm.pkg.github.com'),
    ).toBe(false);
  });

  test('accepts npmjs 404 responses as an absent package version', () => {
    expect(
      shouldTreatNotFoundAsUnpublished(notFound, 'https://registry.npmjs.org'),
    ).toBe(true);
  });
});

describe('authenticationFailureHint', () => {
  test('explains GitHub Packages repository access', () => {
    expect(authenticationFailureHint('https://npm.pkg.github.com')).toContain(
      'linked to this repository',
    );
  });

  test('explains npmjs authentication without GitHub repository advice', () => {
    const hint = authenticationFailureHint('https://registry.npmjs.org');

    expect(hint).toContain('npmjs.org');
    expect(hint).not.toContain('linked to this repository');
  });
});

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
