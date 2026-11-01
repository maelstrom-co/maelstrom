import { z } from 'zod';

const name = z.string().min(1).max(120);
const turnInput = z.strictObject({ intent: z.string().min(1).max(1000) });

/** Navigation-only projection of the current Weather Action contract, not handlers. */
export const weatherNavigationTransitions = {
  current: { showHourly: 'hourly', showWeekly: 'weekly' },
  hourly: { showCurrent: 'current', showWeekly: 'weekly' },
  weekly: { showCurrent: 'current', showHourly: 'hourly' },
} as const;

/** Dataset prompts are independent of the scripted response fixtures. */
export const weatherTransitionChainPrompts = {
  'hourly-weekly-current': [
    'Show me the hourly forecast',
    'Now go straight to weekly',
    'Go back to current',
  ],
  'hourly-current-weekly': [
    'Show hourly',
    'Just show current right now - skip weekly',
    'Go to weekly',
  ],
} as const;

/** Membership projection only; tree geometry and handler state are outside this oracle. */
export const weatherTransitionChainStateSchema = z.strictObject({
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z
      .array(
        z.strictObject({ instanceId: name, vesselId: name, variant: name }),
      )
      .max(20),
  }),
});

/** Invalid Actions and parameters remain representable for negative controls. */
export const weatherTransitionChainResponseSchema =
  weatherTransitionChainStateSchema.extend({
    executionPlan: z
      .array(
        z.strictObject({
          instanceId: name,
          action: name,
          params: z
            .record(
              name,
              z.union([
                z.string().max(1000),
                z.number().finite(),
                z.boolean(),
                z.null(),
              ]),
            )
            .refine(
              (value) => Object.keys(value).length <= 20,
              'At most 20 parameter fields',
            )
            .nullable()
            .optional(),
        }),
      )
      .max(20),
  });

/** Exactly three source requests. */
export const weatherTransitionChainInputsSchema = z.strictObject({
  turns: z.array(turnInput).length(3),
});

/** Two dataset trajectories; neither reuses the legacy scorer's permissive Action checks. */
export const weatherTransitionChainExpectationsSchema = z.discriminatedUnion(
  'trajectory',
  [
    z.strictObject({
      trajectory: z.literal('hourly-weekly-current'),
      instanceId: z.literal('weather-main'),
      actions: z.tuple([
        z.literal('showHourly'),
        z.literal('showWeekly'),
        z.literal('showCurrent'),
      ]),
      variants: z.tuple([
        z.literal('hourly'),
        z.literal('weekly'),
        z.literal('current'),
      ]),
      coverage: z.literal('COMPLETE'),
    }),
    z.strictObject({
      trajectory: z.literal('hourly-current-weekly'),
      instanceId: z.literal('weather-main'),
      actions: z.tuple([
        z.literal('showHourly'),
        z.literal('showCurrent'),
        z.literal('showWeekly'),
      ]),
      variants: z.tuple([
        z.literal('hourly'),
        z.literal('current'),
        z.literal('weekly'),
      ]),
      coverage: z.literal('COMPLETE'),
    }),
  ],
);

/** Independent initial state and three responses, never generated from expectations. */
export const weatherTransitionChainDataSchema = z.strictObject({
  initial: weatherTransitionChainStateSchema.refine((state) => {
    const instance = state.layout.instances[0];
    return (
      state.layout.type === 'tiling' &&
      state.layout.instances.length === 1 &&
      instance?.instanceId === 'weather-main' &&
      instance.vesselId === 'weather' &&
      instance.variant === 'current'
    );
  }, 'Expected one initial weather-main Weather/current Instance'),
  responses: z.array(weatherTransitionChainResponseSchema).length(3),
});

/** Complete ordered evidence, including incoming and retained state. */
export const weatherTransitionChainObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: turnInput,
      state: weatherTransitionChainStateSchema,
      output: weatherTransitionChainResponseSchema,
      resultingState: weatherTransitionChainStateSchema,
    }),
  )
  .length(3);

/** Three source requests. */
export type WeatherTransitionChainInputs = z.infer<
  typeof weatherTransitionChainInputsSchema
>;
/** Code-owned trajectory expectations. */
export type WeatherTransitionChainExpectations = z.infer<
  typeof weatherTransitionChainExpectationsSchema
>;
/** Independent script and initial state. */
export type WeatherTransitionChainData = z.infer<
  typeof weatherTransitionChainDataSchema
>;

/** Rejects mixing the two source trajectories before execution. */
export function validateWeatherTransitionChain(
  inputs: WeatherTransitionChainInputs,
  expectations: WeatherTransitionChainExpectations,
): void {
  const prompts = weatherTransitionChainPrompts[expectations.trajectory];
  if (inputs.turns.some((turn, index) => turn.intent !== prompts[index]))
    throw new Error(
      'Weather transition chain requires its exact dataset prompts',
    );
}
