import type { AnyTextAdapter } from '@tanstack/ai';
import { z } from 'zod';

import type { EngineConfig } from '../config.js';
import type { LLMContextMessage } from '../history/history-manager.js';
import type { HistoryEntry, HistoryStore } from '../history/history-store.js';
import type { Logger } from '../logger.js';

// `T` is compile-time shape only — runtime only verifies that `v` is callable.
// Method signature/arity drift surfaces via the type-level guards below
// (`_adapterFwd`/`_adapterBwd` against `Pick<AnyTextAdapter, …>`, `_loggerFwd`).
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

// Logger is loose because third-party loggers (pino, winston, bunyan, ...)
// structurally satisfy the four-method contract but carry implementation-
// specific own-enumerable state (`level`, `silent`, `transports`, ...) we
// must not reject. The required-method checks still catch typos on the four
// names the engine actually calls.
const loggerSchema = z
  .object({
    debug: functionSchema<Logger['debug']>(),
    info: functionSchema<Logger['info']>(),
    warn: functionSchema<Logger['warn']>(),
    error: functionSchema<Logger['error']>(),
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
// declared type — rejecting them would break idiomatic calls like
// `vars: { assistantName: process.env.NAME }`.
const promptVarsSchema = z.record(z.string(), z.string().optional());

const promptOptionsSchema = z
  .object({
    vars: promptVarsSchema.optional(),
    system: sectionOverridesSchema.optional(),
    user: sectionOverridesSchema.optional(),
  })
  .strict();

// HistoryStore / transformEntry are loose: stores carry implementation-
// specific methods (Redis client, SQL pool, …) and transformEntry is an
// arbitrary user callback. We only enforce the four-method HistoryStore
// contract the engine actually calls.
const historyStoreSchema = z
  .object({
    append: functionSchema<HistoryStore['append']>(),
    get: functionSchema<HistoryStore['get']>(),
    replace: functionSchema<HistoryStore['replace']>(),
    clear: functionSchema<HistoryStore['clear']>(),
  })
  .loose();

const historySchema = z
  .object({
    maxEntries: z.number().int().positive().optional(),
    maxChars: z.number().int().positive().optional(),
    transformEntry:
      functionSchema<(entry: HistoryEntry) => HistoryEntry>().optional(),
    deriveLLMContext:
      functionSchema<
        (entry: HistoryEntry) => readonly LLMContextMessage[]
      >().optional(),
    store: historyStoreSchema,
  })
  .strict();

const engineConfigSchema = z
  .object({
    adapter: adapterSchema,
    logger: loggerSchema.optional(),
    prompt: promptOptionsSchema.optional(),
    history: historySchema.optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    modelOptions: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// Compile-time drift guard. Each check is a named const so a failure points
// to the specific invariant that drifted. Whole-type reverse checks
// (EngineConfig extends inferred) are omitted where the inferred shape can't
// faithfully reproduce the TS side — readonly markers and `| undefined`
// index signatures on the prompt side would require `.optional()` on record
// values, which reintroduces the silent-sentinel hazard. Key parity +
// per-field forward checks + adapter bidirectional against the required-key
// contract cover add/remove drift and the common value-type drifts.
type _InferredEngineConfig = z.infer<typeof engineConfigSchema>;

// Bidirectional check on the adapter is against `Pick<...>` because
// `AnyTextAdapter`'s phantom `~types` field has no runtime shape and can't
// appear in the inferred type. `_adapterBwd` would be tautologically true
// if compared against the full `AnyTextAdapter`.
type _AdapterContract = Pick<
  AnyTextAdapter,
  'kind' | 'name' | 'model' | 'chatStream' | 'structuredOutput'
>;

const _configKeysSubsetInferred: keyof EngineConfig extends keyof _InferredEngineConfig
  ? true
  : false = true;
const _inferredKeysSubsetConfig: keyof _InferredEngineConfig extends keyof EngineConfig
  ? true
  : false = true;
const _adapterFwd: _InferredEngineConfig['adapter'] extends _AdapterContract
  ? true
  : false = true;
const _adapterBwd: _AdapterContract extends _InferredEngineConfig['adapter']
  ? true
  : false = true;
const _loggerFwd: NonNullable<
  _InferredEngineConfig['logger']
> extends NonNullable<EngineConfig['logger']>
  ? true
  : false = true;
const _promptFwd: NonNullable<
  _InferredEngineConfig['prompt']
> extends NonNullable<EngineConfig['prompt']>
  ? true
  : false = true;
void [
  _configKeysSubsetInferred,
  _inferredKeysSubsetConfig,
  _adapterFwd,
  _adapterBwd,
  _loggerFwd,
  _promptFwd,
];

export function validateEngineConfig(config: unknown): EngineConfig {
  const result = engineConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid EngineConfig: ${formatIssues(result.error)}`, {
      cause: result.error,
    });
  }
  // Return the caller's original instance, not `result.data`. Zod's
  // `.object().loose()` rebuilds objects by copying own-enumerable keys,
  // which strips prototype methods from class-based providers — e.g. the
  // Gemini adapter's `chatStream` calls `this.mapCommonOptionsToGemini`,
  // and that helper lives on the prototype. The schema is validate-only
  // (no transforms or defaults — defaults are applied in `resolveConfig`),
  // so discarding `result.data` is safe and keeps adapter, logger, and
  // history.store identity intact across the validation boundary.
  // See `_AdapterContract` — phantom `~types` field requires this cast.
  return config as EngineConfig;
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map(formatIssue).join('; ');
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  const base = `${path} [${issue.code}]: ${issue.message}`;
  if (hasNestedBranches(issue)) {
    const branches = issue.errors
      .map((branch) => branch.map(formatIssue).join(' & '))
      .join(' | ');
    return branches.length > 0 ? `${base} (${branches})` : base;
  }
  if (hasNestedIssues(issue)) {
    const nested = issue.issues.map(formatIssue).join(' & ');
    return nested.length > 0 ? `${base} (${nested})` : base;
  }
  return base;
}

function hasNestedBranches(
  issue: z.core.$ZodIssue,
): issue is z.core.$ZodIssue & {
  readonly errors: readonly z.core.$ZodIssue[][];
} {
  return (
    'errors' in issue && Array.isArray((issue as { errors?: unknown }).errors)
  );
}

function hasNestedIssues(issue: z.core.$ZodIssue): issue is z.core.$ZodIssue & {
  readonly issues: readonly z.core.$ZodIssue[];
} {
  return (
    'issues' in issue && Array.isArray((issue as { issues?: unknown }).issues)
  );
}
