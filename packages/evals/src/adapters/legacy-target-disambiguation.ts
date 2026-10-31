import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const instance = z.strictObject({
  instanceId: name,
  vesselId: name,
  variant: name,
});
const instances = z.array(instance).max(20);

/** Bounded Instance/type projection; no tiling tree or geometry evidence. */
export const targetDisambiguationStateSchema = z.strictObject({
  instances,
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances,
  }),
});

/** Scripted response with semantic faults available to independent scoring. */
export const targetDisambiguationResponseSchema =
  targetDisambiguationStateSchema.extend({
    executionPlan: z
      .array(z.strictObject({ instanceId: name, action: name }))
      .max(20),
  });

/** Request text is evidence only; the harness does not interpret it. */
export const targetDisambiguationTurnInputSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Exactly four complete snapshots, including pre-state and final retained state. */
export const targetDisambiguationObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(3),
      input: targetDisambiguationTurnInputSchema,
      state: targetDisambiguationStateSchema,
      output: targetDisambiguationResponseSchema,
      resultingState: targetDisambiguationStateSchema,
    }),
  )
  .length(4);

/** Four ordered prompts, separate from the scripted responses. */
export const targetDisambiguationInputsSchema = z.strictObject({
  turns: z.array(targetDisambiguationTurnInputSchema).length(4),
});

/** Independent target/preservation constraints; timing and rubric are code-owned. */
export const targetDisambiguationExpectationsSchema = z
  .strictObject({
    instanceId: name,
    action: z.literal('showWeekly'),
    variant: z.literal('weekly'),
    forbidActionsOn: z.tuple([name]),
    unchangedInstances: z.tuple([
      z.strictObject({ instanceId: name, variant: z.literal('month') }),
    ]),
    forbidNewInstances: z.literal(true),
  })
  .refine(
    (expected) =>
      expected.forbidActionsOn[0] ===
        expected.unchangedInstances[0].instanceId &&
      expected.instanceId !== expected.unchangedInstances[0].instanceId,
    'Expected distinct Weather and unchanged Calendar targets',
  );

/** A valid two-Vessel initial state and independent scripted observations. */
export const targetDisambiguationDataSchema = z.strictObject({
  initial: targetDisambiguationStateSchema.refine((state) => {
    const weather = state.instances.find((item) => item.vesselId === 'weather');
    const calendar = state.instances.find(
      (item) => item.vesselId === 'calendar',
    );
    return (
      state.instances.length === 2 &&
      weather?.variant === 'current' &&
      calendar?.variant === 'month' &&
      weather.instanceId !== calendar.instanceId &&
      state.layout.type === 'tiling' &&
      state.layout.instances.length === 2 &&
      new Set(state.layout.instances.map((item) => item.instanceId)).size ===
        2 &&
      state.instances.every((item) =>
        state.layout.instances.some(
          (candidate) =>
            candidate.instanceId === item.instanceId &&
            candidate.vesselId === item.vesselId &&
            candidate.variant === item.variant,
        ),
      )
    );
  }, 'Expected current Weather and month Calendar in the initial tiling layout'),
  responses: z.array(targetDisambiguationResponseSchema).length(4),
});

/** Initial state and four scripted responses. */
export type TargetDisambiguationData = z.infer<
  typeof targetDisambiguationDataSchema
>;
/** Four ordered requests. */
export type TargetDisambiguationInputs = z.infer<
  typeof targetDisambiguationInputsSchema
>;
/** Independent target and Calendar preservation expectations. */
export type TargetDisambiguationExpectations = z.infer<
  typeof targetDisambiguationExpectationsSchema
>;
/** One request in the synthetic session. */
export type TargetDisambiguationInput = z.infer<
  typeof targetDisambiguationTurnInputSchema
>;
/** Response/retained-state projection. */
export type TargetDisambiguationState = z.infer<
  typeof targetDisambiguationStateSchema
>;
/** Scripted response including an Execution Plan. */
export type TargetDisambiguationResponse = z.infer<
  typeof targetDisambiguationResponseSchema
>;
