import { z } from 'zod';
import { labsStateResetSubsetResponseSchema } from './legacy-labs-state-reset-subset.js';

/** Isolated synthetic third prompt, not an additional dataset request or reset session. */
export const labsOptionalEnumInputsSchema = z.strictObject({
  intent: z.literal("What's the trend for hemoglobin?"),
});

/** Complete bounded Execution Plan only; no layout or selected-marker state is represented. */
export const labsOptionalEnumResponseSchema =
  labsStateResetSubsetResponseSchema.pick({ executionPlan: true });

/** Independent candidate; an empty Execution Plan is valid evidence of no selection. */
export const labsOptionalEnumDataSchema = z.strictObject({
  response: labsOptionalEnumResponseSchema,
});

/** D33's optional first-match enum rule, not D19's every-match rule or positive selection. */
export const labsOptionalEnumExpectationsSchema = z.strictObject({
  rule: z.literal('optional-first-marker-enum'),
  instanceId: z.literal('labs-main'),
  action: z.literal('selectMarker'),
  allowedMarkerSlugs: z.tuple([
    z.literal('hemoglobin'),
    z.literal('platelets'),
    z.literal('glucose'),
  ]),
  coverage: z.literal('COMPLETE'),
});

/** One local observation of the synthetic third prompt; not three-turn execution evidence. */
export const labsOptionalEnumObservationSchema = z
  .array(
    z.strictObject({
      index: z.literal(0),
      input: labsOptionalEnumInputsSchema,
      state: z.strictObject({}),
      output: labsOptionalEnumResponseSchema,
      resultingState: z.strictObject({}),
    }),
  )
  .length(1);

/** Independent bounded scripted response. */
export type LabsOptionalEnumData = z.infer<typeof labsOptionalEnumDataSchema>;
/** Existing synthetic third-turn request. */
export type LabsOptionalEnumInputs = z.infer<
  typeof labsOptionalEnumInputsSchema
>;
/** Fixed optional enum contract and declared-scope completion. */
export type LabsOptionalEnumExpectations = z.infer<
  typeof labsOptionalEnumExpectationsSchema
>;
/** Execution Plan projection without layout or marker persistence. */
export type LabsOptionalEnumResponse = z.infer<
  typeof labsOptionalEnumResponseSchema
>;
