import { z } from 'zod';

const name = z.string().min(1).max(120);
const turnInput = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Bounded text, Execution Plan and layout membership projection; no tree geometry. */
export const assistantIdentityResponseSchema = z.strictObject({
  assistantText: z.string().max(2000),
  executionPlan: z
    .array(z.strictObject({ instanceId: name, action: name }))
    .max(20),
  layout: z.strictObject({
    type: z.enum(['tiling', 'grid']),
    instances: z
      .array(
        z.strictObject({ instanceId: name, vesselId: name, variant: name }),
      )
      .max(20),
  }),
});

/** Three independent scripted responses, never manufactured from identity expectations. */
export const assistantIdentityDataSchema = z.strictObject({
  responses: z.array(assistantIdentityResponseSchema).length(3),
});

/** All three dataset prompts retained as evidence, not interpreted. */
export const assistantIdentityInputsSchema = z.strictObject({
  turns: z.array(turnInput).length(3),
});

/** D02's complete response predicate; prompt delivery is tested separately, not inferred. */
export const assistantIdentityExpectationsSchema = z.strictObject({
  requiredIdentity: name,
  forbiddenIdentity: name,
  expectedTurns: z.literal(3),
  requireNonemptyText: z.literal(true),
  executionPlanLength: z.literal(0),
  layoutType: z.literal('tiling'),
  layoutInstanceCount: z.literal(0),
  coverage: z.literal('COMPLETE'),
});

/** Complete ordered evidence; empty state makes no runtime history or identity-memory claim. */
export const assistantIdentityObservationSchema = z
  .array(
    z.strictObject({
      index: z.number().int().min(0).max(2),
      input: turnInput,
      state: z.strictObject({}),
      output: assistantIdentityResponseSchema,
      resultingState: z.strictObject({}),
    }),
  )
  .length(3);

/** Independent synthetic response script. */
export type AssistantIdentityData = z.infer<typeof assistantIdentityDataSchema>;
/** Source request sequence. */
export type AssistantIdentityInputs = z.infer<
  typeof assistantIdentityInputsSchema
>;
/** Declarative response predicate and declared-scope completion. */
export type AssistantIdentityExpectations = z.infer<
  typeof assistantIdentityExpectationsSchema
>;
/** Bounded response projection. */
export type AssistantIdentityResponse = z.infer<
  typeof assistantIdentityResponseSchema
>;
