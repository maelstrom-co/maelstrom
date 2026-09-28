import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Chosen code (the shipped planners, their stages and the shared stage
 * utilities) never imports experiment code, so experiments can be deleted
 * without touching what ships. Tests and test helpers are exempt: a test
 * of chosen code may use an experimental stage as a fixture.
 */

const SRC = resolve(import.meta.dir, '..');

const EXPERIMENTAL_DIRS = ['stages-experimental', 'planners-experimental'].map(
  (name) => join(import.meta.dir, name),
);

// The _internal entry re-exports experimental builders on purpose.
const INTERNAL_BARREL = join(SRC, '_internal.ts');

const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

describe('experimental boundary', () => {
  test('the experimental folders exist, so the rule is not vacuous', () => {
    for (const dir of EXPERIMENTAL_DIRS) expect(existsSync(dir)).toBe(true);
  });

  test('chosen code imports nothing from an experimental folder', () => {
    const chosen = sourceFiles(SRC).filter(
      (file) =>
        !isExperimental(file) && !isTestCode(file) && file !== INTERNAL_BARREL,
    );
    expect(chosen.length).toBeGreaterThan(0);
    const violations = chosen.flatMap((file) =>
      relativeImports(file)
        .filter(isExperimental)
        .map((target) => `${relative(SRC, file)} -> ${relative(SRC, target)}`),
    );
    expect(violations).toEqual([]);
  });

  test('reads static, dynamic and side-effect imports', () => {
    const specifiers = [
      ...`import { a } from './a.js';\nexport * from "./b.js";\nconst c = await import('./c.js');\nimport './d.js';`.matchAll(
        IMPORT_SPECIFIER,
      ),
    ].map((match) => match[1]);
    expect(specifiers).toEqual(['./a.js', './b.js', './c.js', './d.js']);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function isExperimental(path: string): boolean {
  return EXPERIMENTAL_DIRS.some(
    (dir) => path === dir || path.startsWith(`${dir}${sep}`),
  );
}

function isTestCode(path: string): boolean {
  return (
    path.endsWith('.test.ts') || path.split(sep).includes('__test-helpers__')
  );
}

function relativeImports(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)].flatMap(
    ([, specifier]) =>
      specifier?.startsWith('.') ? [resolve(dirname(file), specifier)] : [],
  );
}
