import { formatValidationIssues } from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';
import { z } from 'zod';

import type { LlmPlannerOptions } from './llm-planner.js';

// `T` is compile-time shape only; runtime only verifies that `v` is callable.
// Method signature/arity drift surfaces via the type-level guards below
// (`_adapterFwd`/`_adapterBwd` against `Pick<AnyTextAdapter, …>`).
const functionSchema = <T>() =>
  z.custom<T>((v) => typeof v === 'function', { message: 'expected function' });

// Adapter is loose because providers attach implementation-specific methods
// we must not strip. Inferred shape stays structural so the drift guards
// below catch schema/type divergence at compile time.
const adapterSchema = z
  .object({
    kind: z.literal('text'),
    name: z.string(),
    model: z.string(),
    chatStream: functionSchema<AnyTextAdapter['chatStream']>(),
    structuredOutput: functionSchema<AnyTextAdapter['structuredOutput']>(),
  })
  .loose();

const sectionExtensionSchema = z.union([
  z.object({ prepend: z.string(), append: z.string().optional() }).strict(),
  z.object({ prepend: z.string().optional(), append: z.string() }).strict(),
]);

const sectionCustomizerSchema = z.union([
  z.string(),
  z.null(),
  functionSchema<(defaultContent: string) => string>(),
  sectionExtensionSchema,
]);

const sectionOverridesSchema = z.record(z.string(), sectionCustomizerSchema);

// `PromptVars` index signature is `string | undefined`, and `resolveVars`
// filters undefined before use. Accept undefined values here to match the
// declared type; rejecting them would break idiomatic calls like
// `vars: { assistantName: process.env.NAME }`.
const promptVarsSchema = z.record(z.string(), z.string().optional());

const promptOptionsSchema = z
  .object({
    vars: promptVarsSchema.optional(),
    system: sectionOverridesSchema.optional(),
    user: sectionOverridesSchema.optional(),
  })
  .strict();

const llmPlannerOptionsSchema = z
  .object({
    adapter: adapterSchema,
    prompt: promptOptionsSchema.optional(),
    modelOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// Compile-time drift guard. Each check is a named const so a failure points
// to the specific invariant that drifted. A whole-type reverse check
// (LlmPlannerOptions extends inferred) is omitted because the inferred shape
// can't faithfully reproduce the TS side: readonly markers and `| undefined`
// index signatures on the prompt side would require `.optional()` on record
// values, which reintroduces the silent-sentinel hazard. Key parity + the
// per-field forward check + adapter bidirectional against the required-key
// contract cover add/remove drift and the common value-type drifts.
type _InferredLlmPlannerOptions = z.infer<typeof llmPlannerOptionsSchema>;

// Bidirectional check on the adapter is against `Pick<...>` because
// `AnyTextAdapter`'s phantom `~types` field has no runtime shape and can't
// appear in the inferred type. `_adapterBwd` would be tautologically true
// if compared against the full `AnyTextAdapter`.
type _AdapterContract = Pick<
  AnyTextAdapter,
  'kind' | 'name' | 'model' | 'chatStream' | 'structuredOutput'
>;

const _plannerKeysSubsetInferred: keyof LlmPlannerOptions extends keyof _InferredLlmPlannerOptions
  ? true
  : false = true;
const _inferredKeysSubsetPlanner: keyof _InferredLlmPlannerOptions extends keyof LlmPlannerOptions
  ? true
  : false = true;
const _adapterFwd: _InferredLlmPlannerOptions['adapter'] extends _AdapterContract
  ? true
  : false = true;
const _adapterBwd: _AdapterContract extends _InferredLlmPlannerOptions['adapter']
  ? true
  : false = true;
const _promptFwd: NonNullable<
  _InferredLlmPlannerOptions['prompt']
> extends NonNullable<LlmPlannerOptions['prompt']>
  ? true
  : false = true;
void [
  _plannerKeysSubsetInferred,
  _inferredKeysSubsetPlanner,
  _adapterFwd,
  _adapterBwd,
  _promptFwd,
];

/**
 * Validates `llmPlanner` options, returning the caller's instance rather
 * than Zod's rebuilt copy. Class-based providers keep helpers on the
 * prototype (the Gemini adapter's `chatStream` calls
 * `this.mapCommonOptionsToGemini`), and the copy would strip them.
 */
export function validateLlmPlannerOptions(options: unknown): LlmPlannerOptions {
  const result = llmPlannerOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(
      `Invalid LlmPlannerOptions: ${formatValidationIssues(result.error)}`,
      { cause: result.error },
    );
  }
  // See `_AdapterContract`: the phantom `~types` field requires this cast.
  return options as LlmPlannerOptions;
}
