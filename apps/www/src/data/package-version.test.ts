import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MAELSTROM_PACKAGE_VERSION } from './package-version';

const pinTemplate = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dir,
      '../../../docs/tools/skills/published-examples/package.json.template',
    ),
    'utf8',
  ),
) as { dependencies: Record<string, string> };

describe('MAELSTROM_PACKAGE_VERSION', () => {
  test('equals the react version in the shared published version pin', () => {
    expect(MAELSTROM_PACKAGE_VERSION).toBe(
      pinTemplate.dependencies['@maelstrom-co/react'] as string,
    );
  });

  test('is a 0.x version until the project reaches 1.0 and the FAQ sentence is rewritten', () => {
    expect(MAELSTROM_PACKAGE_VERSION).toMatch(/^0\.\d+\.\d+/);
  });

  test('is an exact version, not a range', () => {
    expect(MAELSTROM_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('matches every other Maelstrom package in the pin so the FAQ advice to align versions holds', () => {
    const maelstromVersions = Object.entries(pinTemplate.dependencies)
      .filter(([name]) => name.startsWith('@maelstrom-co/'))
      .map(([, version]) => version);
    expect(maelstromVersions.length).toBeGreaterThan(1);
    for (const version of maelstromVersions) {
      expect(version).toBe(MAELSTROM_PACKAGE_VERSION);
    }
  });
});
