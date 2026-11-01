import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Enforces the plugin seam documented in the package README: `src/core/`
 * is planner-neutral and takes everything planner-specific from a
 * `PlannerEvalPlugin`. No file under `src/core/`, tests and test helpers
 * included, may import a planner package or reach outside `src/core/`
 * (into `src/plugins/` or the entry points), and none may name a stage of
 * a planner family, in code or in comments.
 *
 * The package lists the planner packages as dependencies for its plugins,
 * so typecheck, lint and the other tests all pass when core imports one;
 * without this test the seam would erode one convenient import at a time.
 */

const CORE = import.meta.dir;
const SELF = relative(CORE, import.meta.path);

const FORBIDDEN_PACKAGES = [
  '@maelstrom-co/planner-jev',
  '@maelstrom-co/planner-llm',
  '@maelstrom-co/client',
];

// Stage and provider names of the planner families the plugins wrap. This
// file names them to forbid them, so it is left out of the scan.
const FORBIDDEN_TOKENS =
  /typesafe|jevSelect|jevActions|jevLayout|llmComplete/gi;

const SPECIFIER =
  /(?:\bimport|\bexport)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;

const files = readdirSync(CORE, { recursive: true, encoding: 'utf8' })
  .filter((entry) => entry.endsWith('.ts'))
  .sort();

test('scans every source file of core', () => {
  expect(files).toContain('plugin.ts');
  expect(files).toContain(join('__test-helpers__', 'fake-planner.ts'));
});

test('no core file imports a planner package or a module outside core', () => {
  const offenders = files.flatMap((file) => {
    const source = readFileSync(join(CORE, file), 'utf8');
    return [...source.matchAll(SPECIFIER)]
      .map((match) => match[1] ?? match[2] ?? '')
      .filter((specifier) => {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(join(CORE, file)), specifier);
          return target !== CORE && !target.startsWith(CORE + sep);
        }
        return FORBIDDEN_PACKAGES.some(
          (name) => specifier === name || specifier.startsWith(`${name}/`),
        );
      })
      .map((specifier) => `${file}: ${specifier}`);
  });
  expect(offenders).toEqual([]);
});

test('the runtime-neutral lifecycle imports only its own runtime contracts', () => {
  const runtime = join(CORE, 'runtime');
  const offenders = files
    .filter(
      (file) => file.startsWith(`runtime${sep}`) && !file.endsWith('.test.ts'),
    )
    .flatMap((file) =>
      [...readFileSync(join(CORE, file), 'utf8').matchAll(SPECIFIER)]
        .map((match) => match[1] ?? match[2] ?? '')
        .filter(
          (specifier) =>
            !specifier.startsWith('.') ||
            !resolve(dirname(join(CORE, file)), specifier).startsWith(
              runtime + sep,
            ),
        )
        .map((specifier) => `${file}: ${specifier}`),
    );
  expect(offenders).toEqual([]);
});

test('no core file names a planner family stage or provider, in code or comments', () => {
  const offenders = files
    .filter((file) => file !== SELF)
    .flatMap((file) =>
      [
        ...readFileSync(join(CORE, file), 'utf8').matchAll(FORBIDDEN_TOKENS),
      ].map((match) => `${file}: ${match[0]}`),
    );
  expect(offenders).toEqual([]);
});
