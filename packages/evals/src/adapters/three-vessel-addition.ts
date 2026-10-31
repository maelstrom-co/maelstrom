import { isDeepStrictEqual } from 'node:util';
import type { Vessel } from '@maelstrom-co/protocol';
import { VariantName, VesselSchema } from '@maelstrom-co/protocol';
import { z } from 'zod';
import type { Verdict } from '../core/runtime/evaluate.js';
import {
  crossVesselResponseSchema,
  crossVesselStateSchema,
} from './legacy-cross-vessel.js';

/** Exact D35 dataset requests; the Weather-only starting scene is user-adjudicated. */
export const threeVesselAdditionInputsSchema = z.strictObject({
  turns: z.tuple([
    z.strictObject({
      intent: z.literal('Add my lab results and calendar to the weather view.'),
    }),
    z.strictObject({
      intent: z.literal('Switch the weather to weekly forecast.'),
    }),
    z.strictObject({
      intent: z.literal('Show me the week view in the calendar.'),
    }),
  ]),
});

/** Complete only for the adjudicated current contract, not legacy equivalence or semantic acceptance. */
export const threeVesselAdditionExpectationsSchema = z.strictObject({
  coverage: z.literal('COMPLETE'),
  initialScene: z.literal('weather-only'),
  labsPreservationBaseline: z.literal('after-addition'),
  weatherAction: z.literal('showWeekly'),
  calendarAction: z.literal('showWeek'),
});

/** Requires the current catalog's creation defaults and the two requested navigation transitions. */
export function validateThreeVesselCatalog(
  vessels: readonly Vessel[],
): boolean {
  const weather = vessels.find(({ id }) => id === 'weather');
  const labs = vessels.find(({ id }) => id === 'labs');
  const calendar = vessels.find(({ id }) => id === 'calendar');
  return (
    vessels.length === 3 &&
    weather?.defaultVariant === 'current' &&
    labs?.defaultVariant === 'trends' &&
    calendar?.defaultVariant === 'month' &&
    weather.variants[VariantName('current')]?.actions.some(
      ({ name, transitionsTo }) =>
        name === 'showWeekly' && transitionsTo === 'weekly',
    ) === true &&
    calendar.variants[VariantName('month')]?.actions.some(
      ({ name, transitionsTo }) =>
        name === 'showWeek' && transitionsTo === 'week',
    ) === true
  );
}

/** Bounded actual Vessel definitions, never selected by a runtime path from case data. */
export const threeVesselAdditionCatalogSchema = z
  .array(VesselSchema)
  .length(3)
  .refine(
    validateThreeVesselCatalog,
    'Expected current Weather/Labs/Calendar defaults and transitions',
  );

const initialInstance = {
  instanceId: 'weather-main',
  vesselId: 'weather',
  variant: 'current',
};

/** Only Weather exists before the first request; Labs preservation starts after creation. */
export const threeVesselAdditionInitialSchema = crossVesselStateSchema.refine(
  ({ layout }) =>
    layout.type === 'tiling' &&
    isDeepStrictEqual(layout.instances, [initialInstance]),
  'D35 starts with only weather-main/Weather/current',
);

/** Independent catalog, initial snapshot and responses; no output is built from expectations. */
export const threeVesselAdditionDataSchema = z.strictObject({
  catalog: threeVesselAdditionCatalogSchema,
  initial: threeVesselAdditionInitialSchema,
  responses: z.array(crossVesselResponseSchema).length(3),
});

/** Complete ordered membership projections, not rendered geometry or client effects. */
export const threeVesselAdditionObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: z.strictObject({ intent: z.string().min(1).max(1000) }),
      state: crossVesselStateSchema,
      output: crossVesselResponseSchema,
      resultingState: crossVesselStateSchema,
    }),
  )
  .length(3);

/** Independent synthetic fixture data. */
export type ThreeVesselAdditionData = z.infer<
  typeof threeVesselAdditionDataSchema
>;
/** Exact source request sequence. */
export type ThreeVesselAdditionInputs = z.infer<
  typeof threeVesselAdditionInputsSchema
>;
/** Fixed adjudicated predicate selection. */
export type ThreeVesselAdditionExpectations = z.infer<
  typeof threeVesselAdditionExpectationsSchema
>;

function sameState(
  a: z.infer<typeof crossVesselStateSchema>,
  b: z.infer<typeof crossVesselStateSchema>,
) {
  const ordered = (state: typeof a) => ({
    type: state.layout.type,
    instances: [...state.layout.instances].sort((x, y) =>
      x.instanceId.localeCompare(y.instanceId),
    ),
  });
  return isDeepStrictEqual(ordered(a), ordered(b));
}

/** Scores addition, incoming Action availability and preservation; non-transition parameters/effects are unscored. */
export function scoreThreeVesselAddition(
  turns: unknown,
  initial: unknown,
  catalog: unknown,
  inputs: unknown,
  expectations: unknown,
): Verdict {
  const parsed = threeVesselAdditionObservationSchema.safeParse(turns);
  const start = threeVesselAdditionInitialSchema.safeParse(initial);
  const vessels = threeVesselAdditionCatalogSchema.safeParse(catalog);
  const requests = threeVesselAdditionInputsSchema.safeParse(inputs);
  const expected =
    threeVesselAdditionExpectationsSchema.safeParse(expectations);
  if (
    !parsed.success ||
    !start.success ||
    !vessels.success ||
    !requests.success ||
    !expected.success
  )
    return {
      outcome: 'fail',
      failures: ['Missing or malformed D35 evidence or adjudicated contract'],
    };
  const failures: string[] = [];
  let previous = start.data;
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== requests.data.turns[index]?.intent
    )
      failures.push(`Turn ${index} changed prompt or order`);
    if (
      !sameState(turn.state, previous) ||
      !sameState(turn.resultingState, turn.output)
    )
      failures.push(`Turn ${index} lost snapshot continuity`);
    const required = [
      { ...initialInstance, variant: index === 0 ? 'current' : 'weekly' },
      { instanceId: 'labs-main', vesselId: 'labs', variant: 'trends' },
      {
        instanceId: 'calendar-main',
        vesselId: 'calendar',
        variant: index === 2 ? 'week' : 'month',
      },
    ];
    if (
      !sameState(turn.output, {
        layout: { type: 'tiling', instances: required },
      })
    )
      failures.push(
        `Turn ${index} changed required membership, identity or Variant`,
      );
    const requiredAction =
      index === 1
        ? { instanceId: 'weather-main', action: expected.data.weatherAction }
        : index === 2
          ? {
              instanceId: 'calendar-main',
              action: expected.data.calendarAction,
            }
          : undefined;
    if (
      requiredAction &&
      !turn.output.executionPlan.some(
        (step) =>
          step.instanceId === requiredAction.instanceId &&
          step.action === requiredAction.action,
      )
    )
      failures.push(`Turn ${index} missing required navigation Action`);
    const incoming = new Map(
      turn.state.layout.instances.map((item) => [item.instanceId, { ...item }]),
    );
    if (index === 0)
      for (const item of turn.output.layout.instances) {
        if (
          item.instanceId === 'labs-main' ||
          item.instanceId === 'calendar-main'
        )
          incoming.set(item.instanceId, { ...item });
      }
    for (const step of turn.output.executionPlan) {
      const instance = incoming.get(step.instanceId);
      const vessel = vessels.data.find(({ id }) => id === instance?.vesselId);
      const action =
        instance &&
        vessel?.variants[VariantName(instance.variant)]?.actions.find(
          ({ name }) => name === step.action,
        );
      if (!action || (index > 0 && step.instanceId === 'labs-main')) {
        failures.push(
          `Turn ${index} unavailable/foreign Action or post-addition Labs mutation`,
        );
        continue;
      }
      if (action.transitionsTo) {
        if (
          action.transitionsTo !==
          required.find(({ instanceId }) => instanceId === step.instanceId)
            ?.variant
        )
          failures.push(`Turn ${index} wrong or premature transition`);
        if (instance) instance.variant = action.transitionsTo;
      }
    }
    previous = turn.resultingState;
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}
