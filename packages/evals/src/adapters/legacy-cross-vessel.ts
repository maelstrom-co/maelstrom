import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-zA-Z0-9-]{0,119}$/);
const instance = z.strictObject({
  instanceId: name,
  vesselId: name,
  variant: name,
});
const weather = instance.extend({
  vesselId: z.literal('weather'),
  variant: z.literal('current'),
});
const calendar = instance.extend({
  vesselId: z.literal('calendar'),
  variant: z.literal('month'),
});
const labs = instance.extend({
  vesselId: z.literal('lab-results'),
  variant: z.literal('trends'),
});
const turnInput = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});
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

/** Membership projection, not visibility geometry or applied client state. */
export const crossVesselStateSchema = z.strictObject({
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z.array(instance).max(20),
  }),
});
/** Bounded Action parameters remain representable but semantically unscored. */
export const crossVesselResponseSchema = crossVesselStateSchema.extend({
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
/** Three declarative requests, independent from scripted responses. */
export const crossVesselInputsSchema = z.strictObject({
  turns: z.array(turnInput).length(3),
});
/** Dataset-aligned Labs identity/Variant and code-owned Weather trajectory. */
export const crossVesselExpectationsSchema = z
  .strictObject({
    weather: z.strictObject({
      instanceId: name,
      vesselId: z.literal('weather'),
      hourlyAction: z.literal('showHourly'),
      hourlyVariant: z.literal('hourly'),
      finalAction: z.literal('showWeekly'),
      finalVariant: z.literal('weekly'),
    }),
    calendar,
    labs,
  })
  .refine(
    (expected) =>
      new Set([
        expected.weather.instanceId,
        expected.calendar.instanceId,
        expected.labs.instanceId,
      ]).size === 3,
    'Expected distinct Weather, Calendar and new Labs identities',
  );
/** Complete ordered snapshots; pre-/retained-state semantics are unscored. */
export const crossVesselObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: turnInput,
      state: crossVesselStateSchema,
      output: crossVesselResponseSchema,
      resultingState: crossVesselStateSchema,
    }),
  )
  .length(3);
/** Registered Labs is initially absent; responses never derive from expectations. */
export const crossVesselDataSchema = z.strictObject({
  registeredVessels: z.tuple([
    z.literal('weather'),
    z.literal('calendar'),
    z.literal('lab-results'),
  ]),
  initial: crossVesselStateSchema.refine((state) => {
    const items = state.layout.instances;
    return (
      state.layout.type === 'tiling' &&
      items.length === 2 &&
      new Set(items.map((item) => item.instanceId)).size === 2 &&
      items.some((item) => weather.safeParse(item).success) &&
      items.some((item) => calendar.safeParse(item).success)
    );
  }, 'Expected only current Weather and month Calendar in the initial tiling layout'),
  responses: z.array(crossVesselResponseSchema).length(3),
});

/** Initial Weather/Calendar context and independent scripted responses. */
export type CrossVesselData = z.infer<typeof crossVesselDataSchema>;
/** Three ordered requests. */
export type CrossVesselInputs = z.infer<typeof crossVesselInputsSchema>;
/** Independent identities and dataset-aligned output constraints. */
export type CrossVesselExpectations = z.infer<
  typeof crossVesselExpectationsSchema
>;
/** Structurally required layout snapshot, without continuity scoring. */
export type CrossVesselState = z.infer<typeof crossVesselStateSchema>;
/** Scripted response projection, not a full protocol response. */
export type CrossVesselResponse = z.infer<typeof crossVesselResponseSchema>;
