import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const instance = z.strictObject({
  instanceId: name,
  vesselId: name,
  variant: name,
});
const scalar = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/** Layout membership projection only; no selected-marker or geometry state. */
export const labsSelectMarkerStateSchema = z.strictObject({
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z.array(instance).max(20),
  }),
});

/** Semantic violations stay representable; parameters project only markerSlug. */
export const labsSelectMarkerResponseSchema =
  labsSelectMarkerStateSchema.extend({
    executionPlan: z
      .array(
        z.strictObject({
          instanceId: name,
          action: name,
          params: z
            .strictObject({ markerSlug: scalar.optional() })
            .nullable()
            .optional(),
        }),
      )
      .max(20),
  });

/** Declarative prompt evidence, not model-interpreted instructions. */
export const labsSelectMarkerTurnInputSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Four complete snapshots; structural validation does not score state continuity. */
export const labsSelectMarkerObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(3),
      input: labsSelectMarkerTurnInputSchema,
      state: labsSelectMarkerStateSchema,
      output: labsSelectMarkerResponseSchema,
      resultingState: labsSelectMarkerStateSchema,
    }),
  )
  .length(4);

/** The bounded case retains exactly four ordered requests. */
export const labsSelectMarkerInputsSchema = z.strictObject({
  turns: z.array(labsSelectMarkerTurnInputSchema).length(4),
});

/** Source-backed selection and navigation constraints, independent of the script. */
export const labsSelectMarkerExpectationsSchema = z.strictObject({
  instanceId: name,
  action: z.literal('selectMarker'),
  markerSlug: z.enum(['hemoglobin', 'platelets', 'glucose']),
  variant: z.literal('trends'),
  forbiddenActions: z.tuple([z.literal('showUpload'), z.literal('showList')]),
  forbidNewInstances: z.literal(true),
});

/** Scripted responses never derive from expected selection parameters. */
export const labsSelectMarkerDataSchema = z.strictObject({
  initial: labsSelectMarkerStateSchema.refine((state) => {
    const initial = state.layout.instances[0];
    return (
      state.layout.type === 'tiling' &&
      state.layout.instances.length === 1 &&
      initial?.vesselId === 'labs' &&
      initial.variant === 'trends'
    );
  }, 'Expected one trends Labs Instance in the initial tiling layout'),
  responses: z.array(labsSelectMarkerResponseSchema).length(4),
});

/** Initial layout and four independent scripted responses. */
export type LabsSelectMarkerData = z.infer<typeof labsSelectMarkerDataSchema>;
/** Ordered request evidence. */
export type LabsSelectMarkerInputs = z.infer<
  typeof labsSelectMarkerInputsSchema
>;
/** Source-backed expectations, not simulated handler state. */
export type LabsSelectMarkerExpectations = z.infer<
  typeof labsSelectMarkerExpectationsSchema
>;
/** A single request in the synthetic session. */
export type LabsSelectMarkerInput = z.infer<
  typeof labsSelectMarkerTurnInputSchema
>;
/** Layout snapshot without selected-marker persistence. */
export type LabsSelectMarkerState = z.infer<typeof labsSelectMarkerStateSchema>;
/** Scripted response projection. */
export type LabsSelectMarkerResponse = z.infer<
  typeof labsSelectMarkerResponseSchema
>;
