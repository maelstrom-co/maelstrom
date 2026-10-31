import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Matcher {
  set: unknown[][];
  match(path: string): boolean;
}

interface DiscoveryController {
  matches(path: string): boolean;
  shouldRecurse(path: string[]): boolean;
  matchDirectories: boolean;
  followSymlinks: boolean;
}

const typeDocUrl = import.meta.resolve('typedoc');
const requireTypeDoc = createRequire(typeDocUrl);
const minimatchRoot = dirname(requireTypeDoc.resolve('minimatch/package.json'));
const {
  Minimatch,
}: {
  Minimatch: new (pattern: string, options: { dot: boolean }) => Matcher;
} = await import(pathToFileURL(join(minimatchRoot, 'dist/esm/index.js')).href);
const {
  glob,
  discoverFiles,
}: {
  glob(
    pattern: string,
    root: string,
    options: { includeDirectories: boolean; followSymlinks: boolean },
  ): string[];
  discoverFiles(root: string, controller: DiscoveryController): string[];
} = await import(new URL('./node-utils.js', typeDocUrl).href);
const {
  legacyPartialMatch,
}: {
  legacyPartialMatch(mini: Matcher, path: string[], row: unknown[]): boolean;
} = await import(new URL('./legacy-partial-match.js', typeDocUrl).href);

let root: string;
const files = [
  'root.ts',
  'src/index.ts',
  'src/ignore.js',
  'src/nested/child.ts',
  'src/nested/a/deep.ts',
  'src/.hidden/hidden.ts',
  'src/.hidden/inner/deep.ts',
  'lib/util.ts',
  'other/unused.ts',
  'node_modules/dependency/index.ts',
  'src/node_modules/dependency/index.ts',
  '.hidden/root.ts',
  '.hidden/inner/deep.ts',
  '.hidden/node_modules/dependency/hidden.ts',
  'src/a/b/c/deep.ts',
];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'typedoc-glob-'));
  for (const file of files) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'export {};\n');
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

// Expected paths captured from TypeDoc 0.28.20 with minimatch 10.2.5.
// An empty segment in the pipe-separated paths denotes the traversal root.
const cases: [pattern: string, dot: boolean, paths: string][] = [
  ['src/*.ts', false, 'src/index.ts'],
  ['!src/*.ts', false, '|root.ts|src|src/ignore.js'],
  ['src/**/index.ts', false, 'src/index.ts'],
  [
    '!src/**/index.ts',
    false,
    '|root.ts|src|src/a|src/a/b|src/a/b/c|src/a/b/c/deep.ts|src/ignore.js|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  [
    '**/*.ts',
    false,
    'lib/util.ts|other/unused.ts|root.ts|src/a/b/c/deep.ts|src/index.ts|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  [
    '!**/*.ts',
    false,
    '|lib|other|src|src/a|src/a/b|src/a/b/c|src/ignore.js|src/nested|src/nested/a',
  ],
  [
    '{src,lib}/**/*.ts',
    false,
    'lib/util.ts|src/a/b/c/deep.ts|src/index.ts|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  [
    '!{src,lib}/**/*.ts',
    false,
    '|lib|root.ts|src|src/a|src/a/b|src/a/b/c|src/ignore.js|src/nested|src/nested/a',
  ],
  ['src/.hidden/*.ts', false, 'src/.hidden/hidden.ts'],
  [
    '!src/.hidden/*.ts',
    false,
    '|root.ts|src|src/.hidden|src/ignore.js|src/index.ts',
  ],
  [
    '**/.hidden/**',
    false,
    '.hidden/inner|.hidden/inner/deep.ts|.hidden/root.ts|src/.hidden/hidden.ts|src/.hidden/inner|src/.hidden/inner/deep.ts',
  ],
  [
    '!**/.hidden/**',
    false,
    '|.hidden|lib|lib/util.ts|other|other/unused.ts|root.ts|src|src/.hidden|src/a|src/a/b|src/a/b/c|src/a/b/c/deep.ts|src/ignore.js|src/index.ts|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  [
    '**/node_modules/**',
    false,
    'node_modules/dependency|node_modules/dependency/index.ts|src/node_modules/dependency|src/node_modules/dependency/index.ts',
  ],
  [
    '!**/node_modules/**',
    false,
    '|.hidden|.hidden/root.ts|lib|lib/util.ts|node_modules|other|other/unused.ts|root.ts|src|src/.hidden|src/.hidden/hidden.ts|src/a|src/a/b|src/a/b/c|src/a/b/c/deep.ts|src/ignore.js|src/index.ts|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts|src/node_modules',
  ],
  [
    'src/node_modules/**',
    false,
    'src/node_modules/dependency|src/node_modules/dependency/index.ts',
  ],
  [
    '!src/node_modules/**',
    false,
    '|root.ts|src|src/ignore.js|src/index.ts|src/node_modules',
  ],
  ['src/*.ts', true, 'src/index.ts'],
  ['!src/*.ts', true, '|root.ts|src|src/ignore.js'],
  ['src/**/index.ts', true, 'src/index.ts'],
  [
    '!src/**/index.ts',
    true,
    '|root.ts|src|src/.hidden|src/.hidden/hidden.ts|src/.hidden/inner|src/.hidden/inner/deep.ts|src/a|src/a/b|src/a/b/c|src/a/b/c/deep.ts|src/ignore.js|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  [
    '**/*.ts',
    true,
    '.hidden/inner/deep.ts|.hidden/root.ts|lib/util.ts|other/unused.ts|root.ts|src/.hidden/hidden.ts|src/.hidden/inner/deep.ts|src/a/b/c/deep.ts|src/index.ts|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  [
    '!**/*.ts',
    true,
    '|.hidden|.hidden/inner|lib|other|src|src/.hidden|src/.hidden/inner|src/a|src/a/b|src/a/b/c|src/ignore.js|src/nested|src/nested/a',
  ],
  [
    '{src,lib}/**/*.ts',
    true,
    'lib/util.ts|src/.hidden/hidden.ts|src/.hidden/inner/deep.ts|src/a/b/c/deep.ts|src/index.ts|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  [
    '!{src,lib}/**/*.ts',
    true,
    '|lib|root.ts|src|src/.hidden|src/.hidden/inner|src/a|src/a/b|src/a/b/c|src/ignore.js|src/nested|src/nested/a',
  ],
  ['src/.hidden/*.ts', true, 'src/.hidden/hidden.ts'],
  [
    '!src/.hidden/*.ts',
    true,
    '|root.ts|src|src/.hidden|src/ignore.js|src/index.ts',
  ],
  [
    '**/.hidden/**',
    true,
    '.hidden/inner|.hidden/inner/deep.ts|.hidden/root.ts|src/.hidden/hidden.ts|src/.hidden/inner|src/.hidden/inner/deep.ts',
  ],
  [
    '!**/.hidden/**',
    true,
    '|.hidden|lib|lib/util.ts|other|other/unused.ts|root.ts|src|src/.hidden|src/a|src/a/b|src/a/b/c|src/a/b/c/deep.ts|src/ignore.js|src/index.ts|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  [
    '**/node_modules/**',
    true,
    '.hidden/node_modules/dependency|.hidden/node_modules/dependency/hidden.ts|node_modules/dependency|node_modules/dependency/index.ts|src/node_modules/dependency|src/node_modules/dependency/index.ts',
  ],
  [
    '!**/node_modules/**',
    true,
    '|.hidden|.hidden/inner|.hidden/inner/deep.ts|.hidden/node_modules|.hidden/root.ts|lib|lib/util.ts|node_modules|other|other/unused.ts|root.ts|src|src/.hidden|src/.hidden/hidden.ts|src/.hidden/inner|src/.hidden/inner/deep.ts|src/a|src/a/b|src/a/b/c|src/a/b/c/deep.ts|src/ignore.js|src/index.ts|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts|src/node_modules',
  ],
  [
    'src/node_modules/**',
    true,
    'src/node_modules/dependency|src/node_modules/dependency/index.ts',
  ],
  [
    '!src/node_modules/**',
    true,
    '|root.ts|src|src/ignore.js|src/index.ts|src/node_modules',
  ],

  ['**/a/b/**', false, 'src/a/b/c|src/a/b/c/deep.ts'],
  [
    '!**/a/b/**',
    false,
    '|.hidden|.hidden/inner|.hidden/inner/deep.ts|.hidden/root.ts|lib|lib/util.ts|other|other/unused.ts|root.ts|src|src/.hidden|src/.hidden/hidden.ts|src/.hidden/inner|src/.hidden/inner/deep.ts|src/a|src/a/b|src/ignore.js|src/index.ts|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  ['**/missing/**/missing/**', false, ''],
  [
    '!**/missing/**/missing/**',
    false,
    '|.hidden|.hidden/inner|.hidden/inner/deep.ts|.hidden/root.ts|lib|lib/util.ts|other|other/unused.ts|root.ts|src|src/.hidden|src/.hidden/hidden.ts|src/.hidden/inner|src/.hidden/inner/deep.ts|src/a|src/a/b|src/a/b/c|src/a/b/c/deep.ts|src/ignore.js|src/index.ts|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  ['**/a/b/**', true, 'src/a/b/c|src/a/b/c/deep.ts'],
  [
    '!**/a/b/**',
    true,
    '|.hidden|.hidden/inner|.hidden/inner/deep.ts|.hidden/root.ts|lib|lib/util.ts|other|other/unused.ts|root.ts|src|src/.hidden|src/.hidden/hidden.ts|src/.hidden/inner|src/.hidden/inner/deep.ts|src/a|src/a/b|src/ignore.js|src/index.ts|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts',
  ],
  ['**/missing/**/missing/**', true, ''],
  [
    '!**/missing/**/missing/**',
    true,
    '|.hidden|.hidden/inner|.hidden/inner/deep.ts|.hidden/root.ts|lib|lib/util.ts|other|other/unused.ts|root.ts|src|src/.hidden|src/.hidden/hidden.ts|src/.hidden/inner|src/.hidden/inner/deep.ts|src/a|src/a/b|src/a/b/c|src/a/b/c/deep.ts|src/ignore.js|src/index.ts|src/nested|src/nested/a|src/nested/a/deep.ts|src/nested/child.ts',
  ],
];

for (const [pattern, dot, paths] of cases) {
  test(`TypeDoc glob ${pattern} (dot=${dot})`, () => {
    const expected = paths ? paths.split('|') : [];
    for (const base of [root, relative(process.cwd(), root)]) {
      for (const includeDirectories of [false, true]) {
        for (const negation of pattern.startsWith('!') ? ['!'] : ['', '!!']) {
          const suffix = pattern.replace(/^!/, '');
          const expression = `${negation}${base}/${suffix}`;
          let actual: string[];
          if (dot) {
            // TypeDoc's glob exposes no dot option; use its discovery controller.
            const mini = new Minimatch(expression, { dot });
            actual = discoverFiles(base, {
              matches: (path) => mini.match(path),
              shouldRecurse: (path) =>
                (path.at(-1) !== 'node_modules' ||
                  expression.includes('node_modules')) &&
                mini.set.some((row) => legacyPartialMatch(mini, path, row)),
              matchDirectories: includeDirectories,
              followSymlinks: true,
            });
          } else {
            actual = glob(expression, base, {
              includeDirectories,
              followSymlinks: true,
            });
          }
          const expectedPaths = includeDirectories
            ? expected
            : expected.filter((path) => files.includes(path));
          expect(actual.map((path) => relative(root, path)).sort()).toEqual(
            [...expectedPaths].sort(),
          );
        }
      }
    }
  });
}
