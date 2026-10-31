import { z } from 'zod';

/** Raw assistant text only; no streaming, Engine or shared-ai.chat evidence. */
export const assistantTextResponseSchema = z.strictObject({
  assistantText: z.string().max(2000),
});

/** Independent single synthetic candidate, never constructed from expectations. */
export const assistantTextDataSchema = z.strictObject({
  response: assistantTextResponseSchema,
});

/** Source user message retained as evidence, not interpreted. */
export const assistantTextInputsSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** Complete source text predicates; D14 semantic judgment is outside this oracle. */
export const assistantTextExpectationsSchema = z.discriminatedUnion('rule', [
  z.strictObject({
    rule: z.literal('exact-text'),
    exactText: z
      .string()
      .min(1)
      .max(2000)
      .refine((text) => !!text.trim()),
  }),
  z.strictObject({
    rule: z.literal('nonempty-not-json-container'),
    coverage: z.literal('COMPLETE'),
  }),
]);

/** One complete session snapshot; empty state carries no layout or history claim. */
export const assistantTextObservationSchema = z
  .array(
    z.strictObject({
      index: z.literal(0),
      input: assistantTextInputsSchema,
      state: z.strictObject({}),
      output: assistantTextResponseSchema,
      resultingState: z.strictObject({}),
    }),
  )
  .length(1);

/** Single independent response fixture. */
export type AssistantTextData = z.infer<typeof assistantTextDataSchema>;
/** Original user message. */
export type AssistantTextInputs = z.infer<typeof assistantTextInputsSchema>;
/** Code-owned source predicate selection and declared-scope completion. */
export type AssistantTextExpectations = z.infer<
  typeof assistantTextExpectationsSchema
>;
/** Bounded assistant-text projection. */
export type AssistantTextResponse = z.infer<typeof assistantTextResponseSchema>;
