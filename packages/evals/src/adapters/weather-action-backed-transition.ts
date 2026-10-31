import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Verdict } from '../core/runtime/evaluate.js';
import {
  crossVesselResponseSchema,
  crossVesselStateSchema,
} from './legacy-cross-vessel.js';

/** Exact D39 request; the matching transition Action is the bounded contract. */
export const weatherActionBackedInputsSchema = z.strictObject({
  intent: z.literal('Skip to weekly forecast'),
});

/** Strengthens the legacy nonempty-plan check without scoring unrelated Actions. */
export const weatherActionBackedExpectationsSchema = z.strictObject({
  rule: z.literal('matching-weekly-transition'),
  coverage: z.literal('COMPLETE'),
});

/** Membership and bounded arbitrary Action parameters; no geometry or handler state. */
export const weatherActionBackedResponseSchema = crossVesselResponseSchema;

/** Existing Weather/current only, not a newly created weekly Instance. */
export const weatherActionBackedInitialSchema = crossVesselStateSchema.refine(
  ({ layout }) =>
    layout.type === 'tiling' &&
    isDeepStrictEqual(layout.instances, [
      { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
    ]),
  'D39 requires one initial weather-main/Weather/current Instance',
);

/** Independent initial snapshot and single scripted response. */
export const weatherActionBackedDataSchema = z.strictObject({
  initial: weatherActionBackedInitialSchema,
  response: weatherActionBackedResponseSchema,
});

/** Complete single-turn evidence; state equality checks observation continuity only. */
export const weatherActionBackedObservationSchema = z
  .array(
    z.strictObject({
      index: z.literal(0),
      input: weatherActionBackedInputsSchema,
      state: weatherActionBackedInitialSchema,
      output: weatherActionBackedResponseSchema,
      resultingState: crossVesselStateSchema,
    }),
  )
  .length(1);

/** Independent scripted response and initial state. */
export type WeatherActionBackedData = z.infer<
  typeof weatherActionBackedDataSchema
>;
/** Fixed source request. */
export type WeatherActionBackedInputs = z.infer<
  typeof weatherActionBackedInputsSchema
>;
/** Code-owned transition rule, not a configurable Action allowlist. */
export type WeatherActionBackedExpectations = z.infer<
  typeof weatherActionBackedExpectationsSchema
>;

/** Requires the existing Weather identity and its matching Action, not merely any nonempty plan. */
export function scoreWeatherActionBackedResponse(response: unknown): Verdict {
  const parsed = weatherActionBackedResponseSchema.safeParse(response);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Missing or malformed D39 response projection'],
    };
  const failures: string[] = [];
  const weather = parsed.data.layout.instances.filter(
    ({ instanceId }) => instanceId === 'weather-main',
  );
  if (
    parsed.data.layout.type !== 'tiling' ||
    weather.length !== 1 ||
    weather[0]?.vesselId !== 'weather' ||
    weather[0]?.variant !== 'weekly'
  )
    failures.push(
      'Expected the existing weather-main/Weather Instance in weekly',
    );
  if (
    !parsed.data.executionPlan.some(
      ({ instanceId, action }) =>
        instanceId === 'weather-main' && action === 'showWeekly',
    )
  )
    failures.push('Missing matching weather-main/showWeekly transition Action');
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}
