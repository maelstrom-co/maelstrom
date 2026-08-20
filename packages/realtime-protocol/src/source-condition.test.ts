import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Node loads this package from source — `apps/demo`'s `dev-agent` and
 * `dev-livekit` scripts run `node --conditions=@maelstrom-co/source`, which
 * resolves every subpath to `src/*.ts` and strips types without a bundler.
 *
 * Type stripping resolves specifiers literally. A `.js` specifier pointing at
 * a `.ts` file on disk is a resolution error under Node and a silent success
 * under Bun and Vite, which both remap the extension. That asymmetry is why
 * this suite shells out to Node instead of importing anything directly: no
 * in-process assertion can observe the difference.
 */
const PACKAGE_ROOT = resolve(import.meta.dir, '..');
const SUBPATHS = ['.', './openai', './livekit', './livekit-wire'] as const;

function sourceEntryPoints(): Array<{ subpath: string; file: string }> {
  const manifest = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  );
  return SUBPATHS.map((subpath) => {
    const target = manifest.exports?.[subpath]?.['@maelstrom-co/source'];
    if (!target) {
      throw new Error(
        `${subpath} declares no "@maelstrom-co/source" condition — Node cannot load it from source.`,
      );
    }
    return { subpath, file: resolve(PACKAGE_ROOT, target) };
  });
}

describe('loads under Node with the source condition', () => {
  for (const { subpath, file } of sourceEntryPoints()) {
    test(`${subpath} imports without a resolution error`, () => {
      // Not `process.execPath` — under `bun test` that is the Bun binary, and
      // Bun remaps `.js` to `.ts`, so the check would pass vacuously.
      const result = spawnSync(
        'node',
        [
          '--conditions=@maelstrom-co/source',
          '--input-type=module',
          '--eval',
          `await import(${JSON.stringify(file)});`,
        ],
        { encoding: 'utf8', cwd: PACKAGE_ROOT },
      );

      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(result.status).toBe(0);
    });
  }
});

/**
 * The import above only fails once a broken specifier is on a reachable path.
 * This walk covers the rest of the module graph, so a `.js` specifier in a
 * file that happens to be unreachable today still fails the build.
 */
describe('relative specifiers name real files', () => {
  test('every relative specifier resolves on disk', () => {
    const MODULE_SPECIFIER =
      /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"](\.[^'"]*)['"]/g;
    const seen = new Set<string>();
    const queue = sourceEntryPoints().map((entry) => entry.file);
    const broken: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);

      const source = readFileSync(file, 'utf8');
      for (const [, specifier] of source.matchAll(MODULE_SPECIFIER)) {
        const target = resolve(dirname(file), specifier);
        try {
          readFileSync(target, 'utf8');
          queue.push(target);
        } catch {
          broken.push(`${file} imports '${specifier}' (no such file)`);
        }
      }
    }

    expect(broken).toEqual([]);
  });
});
