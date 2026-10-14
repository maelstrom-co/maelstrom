import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The shared provider call flow and the shared fetch step stay
 * provider-neutral: each reads only the neutral planner modules, and TanStack
 * AI only for types, so a value import cannot break under the process-wide
 * `@tanstack/ai` test mock or reach the build externals. The call flow never
 * reads the fetch step, so a transport that does not fetch, such as a bridge
 * to a TanStack evaluate adapter, carries none of it. The fetch step reads
 * the call flow for its seam types only.
 */

const NEUTRAL = [
  './ask.js',
  './defer.js',
  './error-identifier.js',
  './questions.js',
  './reply-validation.js',
  '@maelstrom-co/engine',
  '@maelstrom-co/protocol',
  '@tanstack/ai',
  '@tanstack/ai/adapters',
];

const TANSTACK_AI = ['@tanstack/ai', '@tanstack/ai/adapters'];

const SHARED_MODULES = [
  {
    file: 'provider-call.ts',
    allowed: NEUTRAL,
    typeOnly: TANSTACK_AI,
  },
  {
    file: 'provider-fetch.ts',
    allowed: [...NEUTRAL, './provider-call.js'],
    typeOnly: [...TANSTACK_AI, './provider-call.js'],
  },
];

const IMPORT_STATEMENT =
  /^\s*(import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;

const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;

describe.each(SHARED_MODULES)('$file boundary', ({
  file,
  allowed,
  typeOnly,
}) => {
  const source = readFileSync(join(import.meta.dir, file), 'utf8');
  const statements = [...source.matchAll(IMPORT_STATEMENT)].map(
    ([, , typeKeyword, specifier]) => ({
      specifier: specifier as string,
      typeOnly: typeKeyword !== undefined,
    }),
  );

  test('the file has imports, so the rule is not vacuous', () => {
    expect(statements.length).toBeGreaterThan(0);
  });

  test('every import, type imports included, is a neutral module', () => {
    const outside = [
      ...statements.map(({ specifier }) => specifier),
      ...[...source.matchAll(DYNAMIC_IMPORT)].map(([, specifier]) => specifier),
    ].filter((specifier) => !allowed.includes(specifier as string));
    expect(outside).toEqual([]);
  });

  test('TanStack AI, and the call flow from the fetch step, are imported for types only', () => {
    const valueImports = statements.filter(
      ({ specifier, typeOnly: isType }) =>
        typeOnly.includes(specifier) && !isType,
    );
    expect(valueImports).toEqual([]);
  });
});

describe('import reader', () => {
  test('reads type and value imports, multi-line ones included', () => {
    const sample = `import type {\n  A,\n} from '@tanstack/ai';\nimport { b } from './ask.js';\nexport { c } from "./defer.js";\nimport './questions.js';`;
    expect(
      [...sample.matchAll(IMPORT_STATEMENT)].map(([, , type, specifier]) => [
        specifier,
        type !== undefined,
      ]),
    ).toEqual([
      ['@tanstack/ai', true],
      ['./ask.js', false],
      ['./defer.js', false],
      ['./questions.js', false],
    ]);
  });
});
