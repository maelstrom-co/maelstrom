import { describe, expect, test } from 'bun:test';
import {
  createGitHubSourceLinkTemplate,
  resolveDocsSourceRef,
} from './docs-source-links.js';

describe('resolveDocsSourceRef', () => {
  test('uses an explicitly supplied preview commit SHA', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';

    expect(
      resolveDocsSourceRef({
        DOCS_SOURCE_REF: sha,
        WORKERS_CI_COMMIT_SHA: '2222222222222222222222222222222222222222',
        GITHUB_SHA: '1111111111111111111111111111111111111111',
      }),
    ).toBe(sha);
  });

  test('uses the Cloudflare Workers commit SHA when no explicit ref is supplied', () => {
    const sha = '2222222222222222222222222222222222222222';

    expect(
      resolveDocsSourceRef({
        WORKERS_CI_COMMIT_SHA: sha,
        GITHUB_SHA: '1111111111111111111111111111111111111111',
      }),
    ).toBe(sha);
  });

  test('uses the GitHub Actions commit SHA when no explicit ref is supplied', () => {
    const sha = '1111111111111111111111111111111111111111';

    expect(resolveDocsSourceRef({ GITHUB_SHA: sha })).toBe(sha);
  });

  test('uses main when production or local builds supply no source ref', () => {
    expect(resolveDocsSourceRef({})).toBe('main');
  });

  test.each([
    '',
    '.',
    '..',
    '../main',
    'feature/docs',
    'main?x=1',
    'main#fragment',
  ])('rejects unsafe explicit ref %p', (sourceRef) => {
    expect(() => resolveDocsSourceRef({ DOCS_SOURCE_REF: sourceRef })).toThrow(
      `Invalid DOCS_SOURCE_REF: ${JSON.stringify(sourceRef)}`,
    );
  });

  test.each([
    '.',
    '..',
    '../main',
  ])('rejects unsafe GitHub Actions ref %p', (sourceRef) => {
    expect(() => resolveDocsSourceRef({ GITHUB_SHA: sourceRef })).toThrow(
      `Invalid GITHUB_SHA: ${JSON.stringify(sourceRef)}`,
    );
  });

  test.each([
    '.',
    '..',
    '../main',
  ])('rejects unsafe Cloudflare Workers ref %p', (sourceRef) => {
    expect(() =>
      resolveDocsSourceRef({ WORKERS_CI_COMMIT_SHA: sourceRef }),
    ).toThrow(`Invalid WORKERS_CI_COMMIT_SHA: ${JSON.stringify(sourceRef)}`);
  });
});

describe('createGitHubSourceLinkTemplate', () => {
  test('preserves TypeDoc path and line placeholders under the selected ref', () => {
    expect(createGitHubSourceLinkTemplate('preview-sha_1')).toBe(
      'https://github.com/maelstrom-co/maelstrom/blob/preview-sha_1/{path}#L{line}',
    );
  });
});

describe('docs build cache inputs', () => {
  test('include the source ref used to generate repository links', async () => {
    const manifest = await Bun.file(
      new URL('../../package.json', import.meta.url),
    ).json();
    const buildInputs = manifest.nx.targets.build?.inputs as
      | Array<string | Record<string, string>>
      | undefined;

    expect(buildInputs).toContainEqual({ env: 'DOCS_SOURCE_REF' });
    expect(buildInputs).toContainEqual({ env: 'WORKERS_CI_COMMIT_SHA' });
    expect(buildInputs).toContainEqual({ env: 'GITHUB_SHA' });
  });
});
