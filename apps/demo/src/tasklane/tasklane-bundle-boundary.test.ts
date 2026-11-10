import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_DIRECTORY = resolve(import.meta.dirname, '..');
const TASKLANE_DIRECTORY = import.meta.dirname;

// Route code splitting keeps each page in its own chunk only while no page's
// module graph reaches another page's instance or Vessels.
describe('Tasklane bundle boundary', () => {
  it('keeps the home and shop instances, pages and Vessels out of the Tasklane graph', () => {
    const reached = modulesReachableFrom('routes/tasks.tsx');

    expect(reached).toContain('tasklane/maelstrom.ts');
    expect(reached).toContain('tasklane/tasklane-page.tsx');
    expect(reached.filter((path) => path.startsWith('shop/'))).toEqual([]);
    expect(reached.filter((path) => path.startsWith('vessels/'))).toEqual([]);
    expect(reached).not.toContain('lib/maelstrom.ts');
    expect(reached.filter(isHomeOnlyModule)).toEqual([]);
  });

  it('keeps every Tasklane module out of the home and shop graphs', () => {
    for (const entry of ['routes/index.tsx', 'routes/shop.tsx']) {
      expect(
        modulesReachableFrom(entry).filter((path) =>
          path.startsWith('tasklane/'),
        ),
        entry,
      ).toEqual([]);
    }
  });

  it('keeps the Tasklane stores free of the Tasklane Maelstrom instance', () => {
    const stores = sourceFiles(join(TASKLANE_DIRECTORY, 'stores'));

    expect(stores.length).toBeGreaterThan(0);
    for (const store of stores) {
      expect(
        modulesReachableFrom(relative(SRC_DIRECTORY, store)),
        store,
      ).not.toContain('tasklane/maelstrom.ts');
    }
  });
});

// Static `import`/`export ... from`, bare `import '...'` and dynamic
// `import('...')`. Type-only statements are stripped first because the build
// erases them.
const MODULE_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;
const TYPE_ONLY_STATEMENT = /^\s*(?:import|export)\s+type\s[^;]*;/gm;

const HOME_ONLY_MODULES = new Set([
  'lib/maelstrom.ts',
  'components/home-page.tsx',
  'components/keyless-demo.tsx',
  'components/vessel-option-sync.tsx',
  'components/intent-input.tsx',
  'components/demo-header.tsx',
  'components/first-run-hint.tsx',
]);

function isHomeOnlyModule(path: string): boolean {
  return HOME_ONLY_MODULES.has(path);
}

function modulesReachableFrom(entry: string): string[] {
  const reached = new Set<string>();
  const pending = [resolve(SRC_DIRECTORY, entry)];
  for (let file = pending.pop(); file; file = pending.pop()) {
    if (reached.has(file)) continue;
    reached.add(file);
    const source = readFileSync(file, 'utf8').replace(TYPE_ONLY_STATEMENT, '');
    for (const [, specifier] of source.matchAll(MODULE_SPECIFIER)) {
      if (!specifier?.startsWith('.')) continue;
      const target = resolveSourceFile(dirname(file), specifier);
      if (target) pending.push(target);
    }
  }
  return [...reached]
    .map((file) => relative(SRC_DIRECTORY, file).split(sep).join('/'))
    .sort();
}

function resolveSourceFile(
  fromDirectory: string,
  specifier: string,
): string | undefined {
  const base = resolve(fromDirectory, specifier);
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ].find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
