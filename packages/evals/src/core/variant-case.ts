import { z } from 'zod';
import { evalCaseSchema } from './case-schema.js';
import {
  plannedSnapshotExpectationsSchema,
  readScenarioSnapshot,
  scenarioFromSnapshot,
  scenarioSnapshotInputsSchema,
} from './scenario-snapshot.js';
import type { Scenario } from './scenario-types.js';

/** Variant snapshot contract; unsupported expectation fields fail closed. */
export const variantCaseSchema = evalCaseSchema
  .extend({
    id: z.literal('scripted-variant'),
    scenarioId: z.literal('variant'),
    suite: z.literal('development'),
    profile: z.literal('scripted-candidate'),
    surface: z.literal('planner-response'),
    fixtureId: z.literal('variant-candidate'),
    migration: z.literal('json-backed'),
    oracle: z.strictObject({
      id: z.literal('scenario-response'),
      version: z.literal(1),
    }),
    inputs: scenarioSnapshotInputsSchema,
    expectations: plannedSnapshotExpectationsSchema,
  })
  .refine(
    (definition) =>
      definition.lineage.some(
        (source) =>
          source.source === 'current' &&
          source.scenarioId === definition.scenarioId,
      ),
    'Missing current-scenario lineage: variant',
  );

/** Builds the variant Scenario only from validated canonical case data, never from the registry. */
export function variantScenarioFromCase(input: unknown): Scenario {
  return scenarioFromSnapshot(variantCaseSchema.parse(input));
}

/** Loads the code-owned variant path; missing or invalid JSON aborts registry initialization. */
export function loadVariantScenario(): Scenario {
  return variantScenarioFromCase(
    readScenarioSnapshot(
      new URL('../../cases/v1/scripted-variant.json', import.meta.url),
    ),
  );
}
