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

/** Layout membership projection only; no tree geometry or handler state. */
export const multivesselAddStateSchema = z.strictObject({
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z.array(instance).max(20),
  }),
});
/** Action names and bounded JSON parameters are present but semantically unscored. */
export const multivesselAddResponseSchema = multivesselAddStateSchema.extend({
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
/** Two declarative requests, independent from the scripted observations. */
export const multivesselAddInputsSchema = z.strictObject({
  turns: z.array(turnInput).length(2),
});
/** Independent preserved Weather and fresh Calendar identity constraints. */
export const multivesselAddExpectationsSchema = z
  .strictObject({
    retainedInstance: weather,
    addedInstance: z.strictObject({
      instanceId: name,
      vesselId: z.literal('calendar'),
      finalVariant: z.literal('month'),
    }),
  })
  .refine(
    (expected) =>
      expected.retainedInstance.instanceId !==
      expected.addedInstance.instanceId,
    'Expected distinct original Weather and fresh Calendar identities',
  );
/** Two complete ordered snapshots; pre-/retained-state semantics are unscored. */
export const multivesselAddObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(1),
      input: turnInput,
      state: multivesselAddStateSchema,
      output: multivesselAddResponseSchema,
      resultingState: multivesselAddStateSchema,
    }),
  )
  .length(2);
/** Registered source context and independent script; Calendar is initially absent. */
export const multivesselAddDataSchema = z.strictObject({
  registeredVessels: z.tuple([
    z.literal('weather'),
    z.literal('labs'),
    z.literal('calendar'),
  ]),
  initial: multivesselAddStateSchema.refine(
    (state) =>
      state.layout.type === 'tiling' &&
      state.layout.instances.length === 1 &&
      weather.safeParse(state.layout.instances[0]).success,
    'Expected only original Weather/current in the initial tiling layout',
  ),
  responses: z.array(multivesselAddResponseSchema).length(2),
});

/** Initial Weather context and two independent scripted responses. */
export type MultivesselAddData = z.infer<typeof multivesselAddDataSchema>;
/** Two ordered request records. */
export type MultivesselAddInputs = z.infer<typeof multivesselAddInputsSchema>;
/** Weather preservation and selected synthetic Calendar constraints. */
export type MultivesselAddExpectations = z.infer<
  typeof multivesselAddExpectationsSchema
>;
/** Structurally complete layout snapshot, not applied client state. */
export type MultivesselAddState = z.infer<typeof multivesselAddStateSchema>;
/** Scripted response projection. */
export type MultivesselAddResponse = z.infer<
  typeof multivesselAddResponseSchema
>;
