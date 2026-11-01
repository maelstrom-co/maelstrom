import { z } from 'zod';

const text = z.string().max(1000);
const name = z.string().min(1).max(120);
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
const scalar = z.union([text, z.number().finite(), z.boolean(), z.null()]);
function boundedRecord(value: z.ZodType<JsonValue>) {
  return z
    .record(name, value)
    .refine((record) => Object.keys(record).length <= 20);
}
function jsonValue(depth: number): z.ZodType<JsonValue> {
  if (depth === 0) return scalar;
  const child = jsonValue(depth - 1);
  return z.union([scalar, z.array(child).max(20), boundedRecord(child)]);
}

/** Source context only; no layout state or handler effects are represented. */
export const noDualTargetPlanStateSchema = z.strictObject({
  instances: z
    .array(z.strictObject({ instanceId: name, vesselId: name, variant: name }))
    .max(20),
});
/** Complete text/Execution Plan projection; Action names and parameters are semantically unscored. */
export const noDualTargetPlanResponseSchema = z.strictObject({
  assistantText: z.string().max(2000),
  executionPlan: z
    .array(
      z.strictObject({
        instanceId: name,
        action: name,
        params: boundedRecord(jsonValue(3)).nullable().optional(),
      }),
    )
    .max(20),
});
/** Original request, never interpreted by the synthetic harness. */
export const noDualTargetPlanInputsSchema = z.strictObject({
  intent: text.min(1),
});
/** Fixed target-exclusion rubric; no lexical or semantic clarification heuristic. */
export const noDualTargetPlanExpectationsSchema = z.strictObject({
  rule: z.literal('no-dual-target-plan'),
});
/** Independent source context and scripted response, not derived from expectations. */
export const noDualTargetPlanDataSchema = z.strictObject({
  initial: noDualTargetPlanStateSchema,
  response: noDualTargetPlanResponseSchema,
});
/** Exactly one complete bounded turn; snapshots do not certify state preservation. */
export const noDualTargetPlanObservationSchema = z
  .array(
    z.strictObject({
      index: z.literal(0),
      input: noDualTargetPlanInputsSchema,
      state: noDualTargetPlanStateSchema,
      output: noDualTargetPlanResponseSchema,
      resultingState: noDualTargetPlanStateSchema,
    }),
  )
  .length(1);
/** Independent synthetic fixture data. */
export type NoDualTargetPlanData = z.infer<typeof noDualTargetPlanDataSchema>;
/** Request evidence. */
export type NoDualTargetPlanInputs = z.infer<
  typeof noDualTargetPlanInputsSchema
>;
/** Code-owned target-exclusion predicate selection. */
export type NoDualTargetPlanExpectations = z.infer<
  typeof noDualTargetPlanExpectationsSchema
>;
/** Source context, not layout evidence. */
export type NoDualTargetPlanState = z.infer<typeof noDualTargetPlanStateSchema>;
/** Required response projection. */
export type NoDualTargetPlanResponse = z.infer<
  typeof noDualTargetPlanResponseSchema
>;
