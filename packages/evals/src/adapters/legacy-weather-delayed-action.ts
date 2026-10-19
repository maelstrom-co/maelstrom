import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const instance = z.strictObject({
  instanceId: name,
  vesselId: name,
  variant: name,
});
const instances = z.array(instance).max(20);

/** Bounded type/membership projection, not tiling tree or geometry evidence. */
export const weatherDelayedActionStateSchema = z.strictObject({
  instances,
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances,
  }),
});

/** Semantic errors remain representable for independent scoring. */
export const weatherDelayedActionResponseSchema =
  weatherDelayedActionStateSchema.extend({
    executionPlan: z
      .array(z.strictObject({ instanceId: name, action: name }))
      .max(20),
  });

/** One declarative request; no model interprets this text in the synthetic harness. */
export const weatherDelayedActionTurnInputSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Strict complete evidence for three turns, including initial and final state. */
export const weatherDelayedActionObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: weatherDelayedActionTurnInputSchema,
      state: weatherDelayedActionStateSchema,
      output: weatherDelayedActionResponseSchema,
      resultingState: weatherDelayedActionStateSchema,
    }),
  )
  .length(3);

/** Exactly three ordered requests for the bounded delayed-action trajectory. */
export const weatherDelayedActionInputsSchema = z.strictObject({
  turns: z.array(weatherDelayedActionTurnInputSchema).length(3),
});

/** The decisive transition is code-owned; the target is independently declared. */
export const weatherDelayedActionExpectationsSchema = z.strictObject({
  instanceId: name,
  action: z.literal('showWeekly'),
  variant: z.literal('weekly'),
  forbidNewInstances: z.literal(true),
});

/** Observations are fixture data, never generated from expected results. */
export const weatherDelayedActionDataSchema = z.strictObject({
  initial: weatherDelayedActionStateSchema.refine((state) => {
    const initial = state.instances[0];
    const layout = state.layout.instances[0];
    return (
      state.instances.length === 1 &&
      initial?.vesselId === 'weather' &&
      initial.variant === 'current' &&
      state.layout.type === 'tiling' &&
      state.layout.instances.length === 1 &&
      layout?.instanceId === initial.instanceId &&
      layout.vesselId === initial.vesselId &&
      layout.variant === initial.variant
    );
  }, 'Expected one current Weather Instance in the initial tiling layout'),
  responses: z.array(weatherDelayedActionResponseSchema).length(3),
});

/** Initial state and three scripted observations. */
export type WeatherDelayedActionData = z.infer<
  typeof weatherDelayedActionDataSchema
>;
/** Three ordered requests, separate from scripted observations. */
export type WeatherDelayedActionInputs = z.infer<
  typeof weatherDelayedActionInputsSchema
>;
/** Independent target and decisive transition constraints. */
export type WeatherDelayedActionExpectations = z.infer<
  typeof weatherDelayedActionExpectationsSchema
>;
/** A single request in the synthetic session. */
export type WeatherDelayedActionInput = z.infer<
  typeof weatherDelayedActionTurnInputSchema
>;
/** Response and retained-state membership projection. */
export type WeatherDelayedActionState = z.infer<
  typeof weatherDelayedActionStateSchema
>;
/** Scripted response including the ordered Execution Plan. */
export type WeatherDelayedActionResponse = z.infer<
  typeof weatherDelayedActionResponseSchema
>;
