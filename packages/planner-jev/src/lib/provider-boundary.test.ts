import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * The Decisions provider stays separable from TypeSafe: its client and
 * planner setups never load the TypeSafe client or the TypeSafe planner,
 * and the client does not even name their types.
 */

const LIB = import.meta.dir;

const STATIC_IMPORT =
  /^\s*(import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const TYPESAFE_FILES = ['typesafe-client.ts', 'jev-planner.ts'];

const DECISIONS_ENTRIES = [
  'openai-decisions-client.ts',
  'planners/decisions-planner.ts',
  'planners/decisions-composed-pairs.ts',
];

test.each(
  DECISIONS_ENTRIES,
)('the runtime graph of %s never reaches the TypeSafe client or planner', (entry) => {
  const files = importGraph(join(LIB, entry), { types: false });
  expect(files.length).toBeGreaterThan(1);
  expect(files.filter(isTypeSafeFile)).toEqual([]);
});

test('the full graph of the Decisions client, type imports included, never reaches the TypeSafe client', () => {
  const files = importGraph(join(LIB, 'openai-decisions-client.ts'), {
    types: true,
  });
  expect(files.length).toBeGreaterThan(1);
  expect(files.filter(isTypeSafeFile)).toEqual([]);
});

test('the walk sees the TypeSafe planner reach the TypeSafe client, so it is not vacuous', () => {
  const files = importGraph(join(LIB, 'jev-planner.ts'), { types: false });
  expect(files).toContain('typesafe-client.ts');
});

function importGraph(
  entry: string,
  { types }: { readonly types: boolean },
): string[] {
  const files = new Set<string>();
  const pending = [entry];
  for (let file = pending.pop(); file; file = pending.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    const specifiers = [
      ...[...source.matchAll(STATIC_IMPORT)]
        .filter(([, , typeOnly]) => types || typeOnly === undefined)
        .map(([, , , specifier]) => specifier),
      ...[...source.matchAll(DYNAMIC_IMPORT)].map(([, specifier]) => specifier),
    ];
    for (const specifier of specifiers)
      if (specifier?.startsWith('.'))
        pending.push(resolve(dirname(file), specifier).replace(/\.js$/, '.ts'));
  }
  return [...files].map((file) => relative(LIB, file));
}

function isTypeSafeFile(file: string): boolean {
  return TYPESAFE_FILES.includes(file);
}
