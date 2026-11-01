import { z } from 'zod';
import {
  labsStateResetSubsetDataSchema,
  labsStateResetSubsetResponseSchema,
  labsStateResetSubsetStateSchema,
} from './legacy-labs-state-reset-subset.js';

/** Two dataset requests followed by an explicitly synthetic marker request. */
export const labsStateResetSyntheticInputsSchema = z.strictObject({
  turns: z.tuple([
    z.strictObject({
      intent: z.literal('Show me the list of my lab results.'),
    }),
    z.strictObject({ intent: z.literal('Go back to the trends chart.') }),
    z.strictObject({ intent: z.literal("What's the trend for hemoglobin?") }),
  ]),
});

/** Fixed synthetic emission contract, not handler effects or optional enum safety. */
export const labsStateResetSyntheticExpectationsSchema = z.strictObject({
  instanceId: z.literal('labs-main'),
  actions: z.tuple([
    z.literal('showList'),
    z.literal('showTrends'),
    z.literal('selectMarker'),
  ]),
  variants: z.tuple([
    z.literal('list'),
    z.literal('trends'),
    z.literal('trends'),
  ]),
  markerSlug: z.literal('hemoglobin'),
  coverage: z.literal('COMPLETE'),
});

/** Uses the existing bounded projection; invalid Actions and parameters remain representable. */
export const labsStateResetSyntheticDataSchema = z.strictObject({
  initial: labsStateResetSubsetDataSchema.shape.initial,
  responses: z.array(labsStateResetSubsetResponseSchema).length(3),
});

/** Three ordered snapshots with layout membership only, not geometry or selected-marker state. */
export const labsStateResetSyntheticObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: z.strictObject({ intent: z.string().min(1).max(1000) }),
      state: labsStateResetSubsetStateSchema,
      output: labsStateResetSubsetResponseSchema,
      resultingState: labsStateResetSubsetStateSchema,
    }),
  )
  .length(3);

/** Initial state and three independent responses; expectations never generate them. */
export type LabsStateResetSyntheticData = z.infer<
  typeof labsStateResetSyntheticDataSchema
>;
/** Two dataset prompts and the synthetic third prompt. */
export type LabsStateResetSyntheticInputs = z.infer<
  typeof labsStateResetSyntheticInputsSchema
>;
/** Code-owned exact emission constraints for the synthetic sequence. */
export type LabsStateResetSyntheticExpectations = z.infer<
  typeof labsStateResetSyntheticExpectationsSchema
>;
