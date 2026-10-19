import { z } from 'zod';

/** Bounded text projection only; no Actions or layout evidence. */
export const jsonRefusalLexicalResponseSchema = z.strictObject({
  assistantText: z.string().max(2000),
});

/** Independent synthetic response, never generated from expectations. */
export const jsonRefusalLexicalDataSchema = z.strictObject({
  response: jsonRefusalLexicalResponseSchema,
});

/** Request evidence, not interpreted by the synthetic adapter. */
export const jsonRefusalLexicalInputsSchema = z.strictObject({
  intent: z.string().trim().min(1).max(1000),
});

/** User-defined lexical extension, not D14's source semantic oracle. */
export const jsonRefusalLexicalExpectationsSchema = z.strictObject({
  rule: z.literal('raw-json-refusal-and-vessel-help-cues'),
});

/** Single text-only snapshot; empty state cannot establish state safety. */
export const jsonRefusalLexicalObservationSchema = z
  .array(
    z.strictObject({
      index: z.literal(0),
      input: jsonRefusalLexicalInputsSchema,
      state: z.strictObject({}),
      output: jsonRefusalLexicalResponseSchema,
      resultingState: z.strictObject({}),
    }),
  )
  .length(1);

/** Independent response fixture. */
export type JsonRefusalLexicalData = z.infer<
  typeof jsonRefusalLexicalDataSchema
>;
/** Request evidence. */
export type JsonRefusalLexicalInputs = z.infer<
  typeof jsonRefusalLexicalInputsSchema
>;
/** Fixed code-owned cue selection. */
export type JsonRefusalLexicalExpectations = z.infer<
  typeof jsonRefusalLexicalExpectationsSchema
>;
