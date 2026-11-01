import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = z.string().trim().min(1).max(2000);
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const sourcePath = z
  .string()
  .max(300)
  .regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/)
  .refine(
    (value) => !value.split('/').some((part) => part === '.' || part === '..'),
  );
const lineage = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('legacy'),
    revision,
    path: sourcePath,
    taskId: id,
    datasetId: id,
    pointer: z.string().regex(/^\/items\/(0|[1-9]\d*)$/),
  }),
  z.strictObject({
    source: z.literal('current'),
    revision,
    path: sourcePath,
    scenarioId: id,
  }),
]);

/** Internal v1 envelope; composition validates profile-specific inputs and expectations. */
export const evalCaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  title: text,
  purpose: text,
  suite: z.enum(['development', 'validation']),
  profile: id,
  surface: id,
  fixtureId: id,
  scenarioId: id.optional(),
  oracle: z.strictObject({ id, version: z.literal(1) }),
  inputs: z.record(z.string(), z.unknown()),
  expectations: z.record(z.string(), z.unknown()),
  synthetic: z.literal(true),
  review: z.literal('pending-human-review'),
  migration: z.enum([
    'legacy-derived-harness',
    'reference-backed',
    'json-backed',
    'composed-harness',
  ]),
  lineage: z.array(lineage).min(1).max(32),
});

/** Parsed declarative metadata, not executable runtime configuration or proof of privacy review. */
export type EvalCase = z.infer<typeof evalCaseSchema>;

/** Internal fixture envelope; its data schema is owned by the composition profile. */
export const evalFixtureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  kind: id,
  synthetic: z.literal(true),
  data: z.record(z.string(), z.unknown()),
});

/** IDs resolve through this index, never through case-supplied file paths. */
export const evalCaseIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    cases: z
      .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/))
      .min(1)
      .max(1000),
    fixtures: z
      .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/))
      .min(1)
      .max(1000),
  })
  .superRefine((value, context) => {
    for (const field of ['cases', 'fixtures'] as const)
      if (new Set(value[field]).size !== value[field].length)
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Duplicate index entry',
        });
  });
