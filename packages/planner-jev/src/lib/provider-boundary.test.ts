import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The shared provider call flow stays provider-neutral: it reads only the
 * neutral planner modules, and TanStack AI only for types, so a value import
 * cannot break under the process-wide `@tanstack/ai` test mock or reach the
 * build externals.
 */

const PROVIDER_CALL = join(import.meta.dir, 'provider-call.ts');

const ALLOWED = [
  './ask.js',
  './defer.js',
  './questions.js',
  './reply-validation.js',
  '@maelstrom-co/engine',
  '@maelstrom-co/protocol',
  '@tanstack/ai',
  '@tanstack/ai/adapters',
];

const TYPE_ONLY = ['@tanstack/ai', '@tanstack/ai/adapters'];

const IMPORT_STATEMENT =
  /^\s*(import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;

const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;

describe('provider call boundary', () => {
  const source = readFileSync(PROVIDER_CALL, 'utf8');
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
    ].filter((specifier) => !ALLOWED.includes(specifier as string));
    expect(outside).toEqual([]);
  });

  test('TanStack AI is imported for types only', () => {
    const valueImports = statements.filter(
      ({ specifier, typeOnly }) => TYPE_ONLY.includes(specifier) && !typeOnly,
    );
    expect(valueImports).toEqual([]);
  });

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
