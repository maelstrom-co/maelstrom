import { expect, test } from 'bun:test';
import {
  evalCaseIndexSchema,
  evalCaseSchema,
  evalFixtureSchema,
} from './case-schema.js';

const source = {
  source: 'legacy',
  revision: 'a'.repeat(40),
  path: 'langfuse/dataset.json',
  taskId: 'task',
  datasetId: 'duplicate',
  pointer: '/items/37',
};
const sample = {
  schemaVersion: 1,
  id: 'case',
  title: 'Synthetic case',
  purpose: 'Test a bounded behavior',
  suite: 'development',
  profile: 'script',
  surface: 'session',
  fixtureId: 'fixture',
  oracle: { id: 'oracle', version: 1 },
  inputs: {},
  expectations: {},
  synthetic: true,
  review: 'pending-human-review',
  migration: 'legacy-derived-harness',
  lineage: [source],
};

test('strict v1 envelope preserves distinct row pointers even when source IDs repeat', () => {
  const parsed = evalCaseSchema.parse({
    ...sample,
    lineage: [source, { ...source, pointer: '/items/38' }],
  });
  expect(parsed.lineage).toHaveLength(2);
  expect(
    parsed.lineage.map((entry) => entry.source === 'legacy' && entry.pointer),
  ).toEqual(['/items/37', '/items/38']);
  expect(parsed.review).toBe('pending-human-review');
});

test('unsupported versions, missing fields, code selectors and false privacy claims reject', () => {
  for (const change of [
    { schemaVersion: 2 },
    { id: undefined },
    { module: 'arbitrary.js' },
    { command: 'sh' },
    { profile: '../escape' },
    { fixtureId: 'https://example.test' },
    { oracle: { id: 'oracle', version: 2 } },
    { suite: 'holdout' },
    { synthetic: false },
    { review: 'approved' },
    { lineage: [] },
    { lineage: [{ ...source, revision: 'main' }] },
    { lineage: [{ ...source, path: 'src/../secret.ts' }] },
    { lineage: [{ ...source, pointer: '/items/01' }] },
  ])
    expect(() => evalCaseSchema.parse({ ...sample, ...change })).toThrow();
});

test('the explicit index forbids ambiguous files and path resolution from data', () => {
  const index = {
    schemaVersion: 1 as const,
    cases: ['case.json'],
    fixtures: ['fixture.json'],
  };
  expect(evalCaseIndexSchema.parse(index)).toEqual(index);
  for (const cases of [
    ['../case.json'],
    ['/case.json'],
    ['http://host/file.json'],
    ['case.ts'],
    ['case.json', 'case.json'],
  ])
    expect(() => evalCaseIndexSchema.parse({ ...index, cases })).toThrow();
  expect(() =>
    evalCaseIndexSchema.parse({ ...index, command: 'run' }),
  ).toThrow();
  expect(() =>
    evalFixtureSchema.parse({
      schemaVersion: 1,
      id: 'fixture',
      kind: 'state',
      synthetic: true,
      data: {},
      url: 'https://example.test',
    }),
  ).toThrow();
});
