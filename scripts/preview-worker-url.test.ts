import { describe, expect, test } from 'bun:test';
import { validatePreviewWorkerUrl } from './preview-worker-url.ts';

const workerName = 'maelstrom-www-alchemy-pr-42';
const suffix = 'maelstrom-preview.workers.dev';
const expected = `https://${workerName}.${suffix}/`;

describe('validatePreviewWorkerUrl', () => {
  test('accepts only the exact per-PR Worker on the configured preview account', () => {
    expect(validatePreviewWorkerUrl(expected, workerName, suffix)).toBe(
      expected,
    );
    expect(
      validatePreviewWorkerUrl(expected.slice(0, -1), workerName, suffix),
    ).toBe(expected);
  });

  test.each([
    'http://maelstrom-www-alchemy-pr-42.maelstrom-preview.workers.dev/',
    'https://user@maelstrom-www-alchemy-pr-42.maelstrom-preview.workers.dev/',
    'https://maelstrom-www-alchemy-pr-42.maelstrom-preview.workers.dev:443/',
    'https://maelstrom-www-alchemy-pr-42.maelstrom-preview.workers.dev:8443/',
    'https://maelstrom-www-alchemy-pr-42.maelstrom-preview.workers.dev/path',
    'https://maelstrom-www-alchemy-pr-42.maelstrom-preview.workers.dev/?next=prod',
    'https://maelstrom-www-alchemy-pr-42.maelstrom-preview.workers.dev/#fragment',
    'https://maelstrom-www-alchemy-pr-41.maelstrom-preview.workers.dev/',
    'https://maelstrom-www-alchemy-pr-42.attacker.workers.dev/',
    'https://maelstrom-www-alchemy-pr-42.maelstrom-preview.workers.dev.attacker.example/',
  ])('rejects non-canonical or wrong-origin URL %s', (value) => {
    expect(() => validatePreviewWorkerUrl(value, workerName, suffix)).toThrow(
      'must be exactly',
    );
  });

  test('fails closed on untrusted Worker names and account suffixes', () => {
    expect(() =>
      validatePreviewWorkerUrl(expected, 'production', suffix),
    ).toThrow('Worker name');
    expect(() => validatePreviewWorkerUrl(expected, workerName, '')).toThrow(
      'suffix',
    );
    expect(() =>
      validatePreviewWorkerUrl(expected, workerName, 'attacker.example'),
    ).toThrow('suffix');
  });
});
