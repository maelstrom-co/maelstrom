import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * The build marks `bun:test` external so the `_testing` entry can bundle its
 * mocks, which means a test helper reached from a published entry would ship
 * instead of failing the build. These walks are that guard.
 */

const SRC = import.meta.dir;

const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

test('the root entry reaches no test helper and no bun:test', () => {
  const { files, packages } = importGraph(join(SRC, 'index.ts'));
  expect(files.length).toBeGreaterThan(1);
  expect(files.filter(isTestHelper).map((file) => relative(SRC, file))).toEqual(
    [],
  );
  expect(packages).not.toContain('bun:test');
});

test('the _eval entry reaches no bun:test and no chat mock', () => {
  const { files, packages } = importGraph(join(SRC, '_eval.ts'));
  expect(files.some((file) => file.endsWith('mock-chat.ts'))).toBe(false);
  expect(packages).not.toContain('bun:test');
});

test('the walk sees the _testing entry reach bun:test, so it is not vacuous', () => {
  const { files, packages } = importGraph(join(SRC, '_testing.ts'));
  expect(files.some(isTestHelper)).toBe(true);
  expect(packages).toContain('bun:test');
});

function importGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file; file = pending.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(
      IMPORT_SPECIFIER,
    )) {
      if (!specifier) continue;
      if (specifier.startsWith('.')) {
        pending.push(resolve(dirname(file), specifier).replace(/\.js$/, '.ts'));
      } else {
        packages.add(specifier);
      }
    }
  }
  return { files: [...files], packages: [...packages] };
}

function isTestHelper(path: string): boolean {
  return path.split(sep).includes('__test-helpers__');
}
