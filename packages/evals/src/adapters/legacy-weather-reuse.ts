import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const instance = z.strictObject({
  instanceId: name,
  vesselId: name,
  variant: name,
});
const instances = z.array(instance).max(20);

/** Bounded type/membership projection, not tiling tree or geometry evidence. */
export const weatherReuseStateSchema = z.strictObject({
  instances,
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances,
  }),
});

/** Semantic errors remain representable for independent scoring. */
export const weatherReuseResponseSchema = weatherReuseStateSchema.extend({
  executionPlan: z
    .array(z.strictObject({ instanceId: name, action: name }))
    .max(20),
});

/** One declarative request; no model interprets this text in the synthetic harness. */
export const weatherReuseTurnInputSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Strict complete evidence for four turns, including initial and final state. */
export const weatherReuseObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(3),
      input: weatherReuseTurnInputSchema,
      state: weatherReuseStateSchema,
      output: weatherReuseResponseSchema,
      resultingState: weatherReuseStateSchema,
    }),
  )
  .length(4);

/** Exactly four ordered requests for the bounded reuse trajectory. */
export const weatherReuseInputsSchema = z.strictObject({
  turns: z.array(weatherReuseTurnInputSchema).length(4),
});

/** The decisive transition is code-owned; the target is independently declared. */
export const weatherReuseExpectationsSchema = z.strictObject({
  instanceId: name,
  action: z.literal('showWeekly'),
  variant: z.literal('weekly'),
  forbidNewInstances: z.literal(true),
});

/** Observations are fixture data, never generated from expected results. */
export const weatherReuseDataSchema = z.strictObject({
  initial: weatherReuseStateSchema.refine((state) => {
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
  responses: z.array(weatherReuseResponseSchema).length(4),
});

/** Initial state and four scripted observations. */
export type WeatherReuseData = z.infer<typeof weatherReuseDataSchema>;
/** Four ordered requests, separate from scripted observations. */
export type WeatherReuseInputs = z.infer<typeof weatherReuseInputsSchema>;
/** Independent target and decisive transition constraints. */
export type WeatherReuseExpectations = z.infer<
  typeof weatherReuseExpectationsSchema
>;
/** A single request in the synthetic session. */
export type WeatherReuseInput = z.infer<typeof weatherReuseTurnInputSchema>;
/** Response and retained-state membership projection. */
export type WeatherReuseState = z.infer<typeof weatherReuseStateSchema>;
/** Scripted response including the ordered Execution Plan. */
export type WeatherReuseResponse = z.infer<typeof weatherReuseResponseSchema>;
