import { describe, expect, test } from 'bun:test';

describe('normalizeBunTestArgs', () => {
  test('removes a verbose reporter passed as --reporter=value', async () => {
    const module = await import('./run-bun-test.js').catch(() => null);

    expect(module).not.toBeNull();
    expect(module?.normalizeBunTestArgs(['--reporter=verbose'])).toEqual([]);
  });

  test('removes a verbose reporter passed as separate args while preserving other flags', async () => {
    const module = await import('./run-bun-test.js').catch(() => null);

    expect(module).not.toBeNull();
    expect(
      module?.normalizeBunTestArgs([
        '--passWithNoTests=true',
        '--reporter',
        'verbose',
        'src/example.test.ts',
      ]),
    ).toEqual(['--passWithNoTests=true', 'src/example.test.ts']);
  });

  test('preserves supported reporters', async () => {
    const module = await import('./run-bun-test.js').catch(() => null);

    expect(module).not.toBeNull();
    expect(module?.normalizeBunTestArgs(['--reporter=junit'])).toEqual([
      '--reporter=junit',
    ]);
  });

  test('runs bun test from the package root rather than the scripts directory', async () => {
    const module = await import('./run-bun-test.js').catch(() => null);

    expect(module).not.toBeNull();
    expect(
      module?.resolveBunTestWorkingDirectory(
        '/repo/packages/voice-server/scripts',
      ),
    ).toBe('/repo/packages/voice-server');
  });
});
