import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIRECTORY = resolve(import.meta.dirname, '..');
const SHOP_DIRECTORY = import.meta.dirname;

// Route code splitting keeps the two pages in separate chunks only while
// neither page's module graph reaches the other page's instance or Vessels.
describe('shop bundle boundary', () => {
  it('keeps the home instance, home page and home Vessels out of the shop page graph', () => {
    const reached = modulesReachableFrom('routes/shop.tsx');

    expect(reached).toContain('shop/maelstrom.ts');
    expect(reached).toContain('shop/shop-page.tsx');
    expect(reached.filter(isHomeOnlyModule)).toEqual([]);
  });

  it('keeps the shop instance and every shop module out of the home page graph', () => {
    const reached = modulesReachableFrom('routes/index.tsx');

    expect(reached).toContain('lib/maelstrom.ts');
    expect(reached.filter((path) => path.startsWith('shop/'))).toEqual([]);
  });

  it('keeps the shop stores free of the shop Maelstrom instance', () => {
    const stores = sourceFiles(join(SHOP_DIRECTORY, 'stores'));

    expect(stores.length).toBeGreaterThan(0);
    for (const store of stores) {
      expect(
        modulesReachableFrom(relative(SRC_DIRECTORY, store)),
        store,
      ).not.toContain('shop/maelstrom.ts');
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
const HOME_VESSEL_MODULE = /^vessels\/(?:calendar|tasks|journal|map|weather)\./;

function isHomeOnlyModule(path: string): boolean {
  return HOME_ONLY_MODULES.has(path) || HOME_VESSEL_MODULE.test(path);
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
