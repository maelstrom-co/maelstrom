import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { loadPlannerScenario } from './planner-case.js';
import {
  readScenarioSnapshot,
  scenarioSnapshotInputsSchema,
} from './scenario-snapshot.js';
import type { Scenario } from './scenario-types.js';
import { loadVariantScenario } from './variant-case.js';

const id = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const name = z.string().min(1).max(120);
const names = z.array(name).max(1000);
const tree = z.array(z.string().min(1).max(1000).nullable()).max(1000);
const ask = z.strictObject({ instanceId: name, action: name, parameter: name });
const arrangement = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('order'),
    ids: names,
    axis: z.enum(['x', 'y']),
  }),
  z.strictObject({
    kind: z.enum(['leftOf', 'rightOf', 'above', 'below']),
    a: name,
    b: name,
  }),
  z.strictObject({
    kind: z.literal('dominant'),
    id: name,
    minShare: z.number().finite(),
  }),
  z.strictObject({
    kind: z.enum(['spansFullWidth', 'spansFullHeight']),
    id: name,
  }),
  z.strictObject({ kind: z.enum(['sideBySide', 'stacked']), ids: names }),
  z.strictObject({ kind: z.literal('unchangedTree') }),
  z.strictObject({
    kind: z.literal('weightRatio'),
    a: name,
    b: name,
    min: z.number().finite(),
    max: z.number().finite(),
  }),
]);

/** The existing scorer's complete declarative language, without new semantic constraints. */
export const scenarioExpectationsSchema = z.strictObject({
  status: z.enum(['planned', 'deferred']),
  deferStage: z.enum(['select', 'actions', 'layout']).optional(),
  deferCause: z.literal('arrangement_not_stated').optional(),
  visible: names.optional(),
  retained: names.optional(),
  tree: tree.optional(),
  arrangement: z.array(arrangement).max(1000).optional(),
  actions: z
    .array(
      z.strictObject({
        instanceId: name,
        action: name,
        params: z.record(z.string().min(1).max(120), z.json()).optional(),
      }),
    )
    .max(1000)
    .optional(),
  asks: z.array(ask).max(1000).optional(),
  noListedMatch: z.array(ask).max(1000).optional(),
  expectedGates: z.record(name, z.enum(['yes', 'no'])).optional(),
});

/** Full Scenario snapshot; optional fields are neither invented nor defaulted. */
export const scenarioDataSchema = z.strictObject({
  id,
  suite: z.enum(['development', 'holdout']),
  title: z.string().min(1).max(2000),
  request: scenarioSnapshotInputsSchema.shape.request,
  history: scenarioSnapshotInputsSchema.shape.history,
  expected: scenarioExpectationsSchema,
  spatial: z.boolean().optional(),
});

/** Provenance identifies the pre-migration registry, not model or holdout-quality evidence. */
export const scenarioDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    source: z.strictObject({
      revision: z.string().regex(/^[a-f0-9]{40}$/),
      path: z.literal('packages/evals/src/core/scenarios.ts'),
      scenarioId: id,
    }),
    scenario: scenarioDataSchema,
  })
  .refine(
    (value) => value.source.scenarioId === value.scenario.id,
    'Mismatched scenario provenance',
  );

const caseId = z.enum(['variant', 'preserve', 'generate-content']);
/** Ordered v1 registry; the three case-owned snapshots cannot be replaced by ordinary files. */
export const scenarioManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    entries: z
      .array(
        z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('case'), id: caseId }),
          z.strictObject({
            kind: z.literal('snapshot'),
            id: id.refine((value) => !caseId.safeParse(value).success),
          }),
        ]),
      )
      .length(155),
  })
  .superRefine(({ entries }, context) => {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      context.addIssue({ code: 'custom', message: 'Duplicate scenario ID' });
    if (entries.filter((entry) => entry.kind === 'case').length !== 3)
      context.addIssue({
        code: 'custom',
        message: 'Missing case-owned scenario',
      });
  });

/** Validates a snapshot losslessly and binds its identity to the manifest entry. */
export function scenarioFromDocument(
  input: unknown,
  expectedId: string,
): Scenario {
  const decoded = scenarioDocumentSchema.parse(input);
  if (decoded.scenario.id !== expectedId || !isDeepStrictEqual(input, decoded))
    throw new Error('Mismatched or lossy scenario snapshot');
  return decoded.scenario;
}

/** Loads the fixed registry in manifest order; file and aggregate limits apply before parsing. */
export function loadScenarioRegistry(): {
  scenarios: readonly Scenario[];
  jsonBackedScenarioIds: readonly string[];
} {
  const root = new URL('../../scenarios/v1/', import.meta.url);
  for (const directory of [
    new URL('../', root),
    root,
    new URL('snapshots/', root),
  ]) {
    const stat = lstatSync(resolve(fileURLToPath(directory)));
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Invalid scenario directory');
  }
  let remaining = 8 * 1024 * 1024;
  const read = (url: URL) =>
    readScenarioSnapshot(url, (size) => {
      remaining -= size;
      if (remaining < 0)
        throw new Error('Scenario registry exceeds aggregate byte limit');
    });
  const manifest = scenarioManifestSchema.parse(
    read(new URL('index.json', root)),
  );
  const scenarios = manifest.entries.map((entry) => {
    if (entry.kind === 'snapshot')
      return scenarioFromDocument(
        read(new URL(`snapshots/${entry.id}.json`, root)),
        entry.id,
      );
    // Case loaders enforce their own 64 KiB limit; reserve that upper bound before reading.
    remaining -= 65_536;
    if (remaining < 0)
      throw new Error('Scenario registry exceeds aggregate byte limit');
    return entry.id === 'variant'
      ? loadVariantScenario()
      : loadPlannerScenario(entry.id);
  });
  return {
    scenarios,
    jsonBackedScenarioIds: manifest.entries.map(({ id }) => id),
  };
}
