import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
const scalar = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
function jsonValue(depth: number): z.ZodType<JsonValue> {
  if (depth === 0) return scalar;
  const child = jsonValue(depth - 1);
  return z.union([scalar, z.array(child).max(20), boundedRecord(child)]);
}
function boundedRecord(value: z.ZodType<JsonValue>) {
  return z
    .record(z.string().min(1).max(120), value)
    .refine(
      (record) => Object.keys(record).length <= 20,
      'At most 20 parameter fields',
    );
}

/** Layout projection only; no selected-marker state or continuity scoring. */
export const labsMultiMarkerFinalStateSchema = z.strictObject({
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z
      .array(
        z.strictObject({ instanceId: name, vesselId: name, variant: name }),
      )
      .max(20),
  }),
});

/** Extra Actions and bounded JSON parameters are representable, not semantically scored. */
export const labsMultiMarkerFinalResponseSchema =
  labsMultiMarkerFinalStateSchema.extend({
    executionPlan: z
      .array(
        z.strictObject({
          instanceId: name,
          action: name,
          params: boundedRecord(jsonValue(3)).nullable().optional(),
        }),
      )
      .max(20),
  });
const turnInput = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Exactly three ordered request records, never interpreted by the fixture. */
export const labsMultiMarkerFinalInputsSchema = z.strictObject({
  turns: z.array(turnInput).length(3),
});
/** Fixed final-turn exact-set rubric; dataset “all three” is explicitly strengthened. */
export const labsMultiMarkerFinalExpectationsSchema = z.strictObject({
  instanceId: z.literal('labs-main'),
  action: z.literal('selectMarkers'),
  markerSlugs: z
    .array(z.enum(['hemoglobin', 'platelets', 'glucose']))
    .length(3)
    .refine(
      (slugs) => new Set(slugs).size === 3,
      'Expected exactly three unique marker slugs',
    ),
});
/** Three complete snapshots; layout and intermediate Actions are unscored. */
export const labsMultiMarkerFinalObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: turnInput,
      state: labsMultiMarkerFinalStateSchema,
      output: labsMultiMarkerFinalResponseSchema,
      resultingState: labsMultiMarkerFinalStateSchema,
    }),
  )
  .length(3);
/** Independent script data, never generated from expectations. */
export const labsMultiMarkerFinalDataSchema = z.strictObject({
  initial: labsMultiMarkerFinalStateSchema,
  responses: z.array(labsMultiMarkerFinalResponseSchema).length(3),
});
/** Independent scripted session. */
export type LabsMultiMarkerFinalData = z.infer<
  typeof labsMultiMarkerFinalDataSchema
>;
/** Three declarative prompts. */
export type LabsMultiMarkerFinalInputs = z.infer<
  typeof labsMultiMarkerFinalInputsSchema
>;
/** Fixed exact-set expectations. */
export type LabsMultiMarkerFinalExpectations = z.infer<
  typeof labsMultiMarkerFinalExpectationsSchema
>;
/** Unscored layout snapshot. */
export type LabsMultiMarkerFinalState = z.infer<
  typeof labsMultiMarkerFinalStateSchema
>;
/** Bounded response projection. */
export type LabsMultiMarkerFinalResponse = z.infer<
  typeof labsMultiMarkerFinalResponseSchema
>;
