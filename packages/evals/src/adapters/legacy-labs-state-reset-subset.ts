import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const turnInput = z.strictObject({ intent: z.string().min(1).max(1000) });
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
  return z.union([
    scalar,
    z.array(child).max(20),
    z
      .record(z.string().min(1).max(120), child)
      .refine(
        (record) => Object.keys(record).length <= 20,
        'At most 20 parameter fields',
      ),
  ]);
}

/** Layout projection only; no selected-marker or geometry state. */
export const labsStateResetSubsetStateSchema = z.strictObject({
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z
      .array(
        z.strictObject({ instanceId: name, vesselId: name, variant: name }),
      )
      .max(20),
  }),
});

/** Bounded JSON Action parameters are representable but never semantically scored. */
export const labsStateResetSubsetResponseSchema =
  labsStateResetSubsetStateSchema.extend({
    executionPlan: z
      .array(
        z.strictObject({
          instanceId: name,
          action: name,
          params: jsonValue(4).optional(),
        }),
      )
      .max(20),
  });

/** Only the two supplied dataset prompts; no invented third request. */
export const labsStateResetSubsetInputsSchema = z.strictObject({
  turns: z.tuple([
    z.strictObject({
      intent: z.literal('Show me the list of my lab results.'),
    }),
    z.strictObject({ intent: z.literal('Go back to the trends chart.') }),
  ]),
});

/** Independent target and code-owned two-turn output constraints, not full T12. */
export const labsStateResetSubsetExpectationsSchema = z.strictObject({
  instanceId: name,
  actions: z.tuple([z.literal('showList'), z.literal('showTrends')]),
  variants: z.tuple([z.literal('list'), z.literal('trends')]),
});

/** Exactly two complete snapshots; pre-/retained-state semantics are unscored. */
export const labsStateResetSubsetObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(1),
      input: turnInput,
      state: labsStateResetSubsetStateSchema,
      output: labsStateResetSubsetResponseSchema,
      resultingState: labsStateResetSubsetStateSchema,
    }),
  )
  .length(2);

/** Independent script; the initial Labs/trends snapshot is not an oracle result. */
export const labsStateResetSubsetDataSchema = z.strictObject({
  initial: labsStateResetSubsetStateSchema.refine((state) => {
    const initial = state.layout.instances[0];
    return (
      state.layout.type === 'tiling' &&
      state.layout.instances.length === 1 &&
      initial?.instanceId === 'labs-main' &&
      initial.vesselId === 'labs' &&
      initial.variant === 'trends'
    );
  }, 'Expected initial labs-main Labs/trends in tiling layout'),
  responses: z.array(labsStateResetSubsetResponseSchema).length(2),
});

/** Two independent scripted responses and initial layout. */
export type LabsStateResetSubsetData = z.infer<
  typeof labsStateResetSubsetDataSchema
>;
/** The two supplied dataset requests. */
export type LabsStateResetSubsetInputs = z.infer<
  typeof labsStateResetSubsetInputsSchema
>;
/** Output-only subset expectations. */
export type LabsStateResetSubsetExpectations = z.infer<
  typeof labsStateResetSubsetExpectationsSchema
>;
/** Structurally required snapshot, without marker persistence. */
export type LabsStateResetSubsetState = z.infer<
  typeof labsStateResetSubsetStateSchema
>;
/** Bounded response projection. */
export type LabsStateResetSubsetResponse = z.infer<
  typeof labsStateResetSubsetResponseSchema
>;
