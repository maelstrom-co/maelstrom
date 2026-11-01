import { z } from 'zod';
import { evalCaseSchema } from './case-schema.js';
import {
  plannedSnapshotExpectationsSchema,
  readScenarioSnapshot,
  scenarioFromSnapshot,
  scenarioSnapshotInputsSchema,
} from './scenario-snapshot.js';
import type { Scenario } from './scenario-types.js';

const plannerSnapshot = evalCaseSchema.extend({
  suite: z.literal('development'),
  profile: z.literal('planner'),
  surface: z.literal('planner-response'),
  fixtureId: z.literal('planner-script'),
  migration: z.literal('json-backed'),
  oracle: z.strictObject({
    id: z.literal('scenario-response'),
    version: z.literal(1),
  }),
  inputs: scenarioSnapshotInputsSchema.extend({
    response: z.enum(['preserve', 'defer']),
  }),
});

/** Only the two migrated planner contracts; replay remains reference-backed. */
export const plannerCaseSchema = z
  .discriminatedUnion('id', [
    plannerSnapshot.extend({
      id: z.literal('planner-preserve'),
      scenarioId: z.literal('preserve'),
      expectations: plannedSnapshotExpectationsSchema.extend({
        tree: z.array(z.string().min(1).max(1000).nullable()).max(1000),
        arrangement: z.tuple([
          z.strictObject({ kind: z.literal('unchangedTree') }),
        ]),
      }),
    }),
    plannerSnapshot.extend({
      id: z.literal('planner-deferral'),
      scenarioId: z.literal('generate-content'),
      expectations: z.strictObject({
        status: z.literal('deferred'),
        deferStage: z.literal('select'),
      }),
    }),
  ])
  .refine(
    (definition) =>
      definition.lineage.some(
        (source) =>
          source.source === 'current' &&
          source.scenarioId === definition.scenarioId,
      ),
    'Missing current-scenario lineage',
  );

/** Decodes the selected case, without looking up a potentially different registry snapshot. */
export function plannerScenarioFromCase(input: unknown): Scenario {
  return scenarioFromSnapshot(plannerCaseSchema.parse(input));
}

/** Reads a fixed canonical source and rejects swapped identities without a TypeScript fallback. */
export function loadPlannerScenario(
  id: 'preserve' | 'generate-content',
): Scenario {
  const url =
    id === 'preserve'
      ? new URL('../../cases/v1/planner-preserve.json', import.meta.url)
      : new URL('../../cases/v1/planner-deferral.json', import.meta.url);
  const scenario = plannerScenarioFromCase(readScenarioSnapshot(url));
  if (scenario.id !== id) throw new Error('Mismatched canonical scenario');
  return scenario;
}
