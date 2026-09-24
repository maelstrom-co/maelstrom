import { z } from 'zod';

import type { EngineConfig } from '../config.js';
import type { LLMContextMessage } from '../history/history-manager.js';
import type { HistoryEntry, HistoryStore } from '../history/history-store.js';
import type { Logger } from '../logger.js';
import type { Planner } from '../planner/stage.js';
import { formatValidationIssues } from './format-validation-issues.js';

// `T` is compile-time shape only — runtime only verifies that `v` is callable.
// Method signature/arity drift surfaces via the type-level guards below
// (`_loggerFwd`).
const functionSchema = <T>() =>
  z.custom<T>((v) => typeof v === 'function', { message: 'expected function' });

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

const retrySchema = z.union([
  z.literal(false),
  z.object({ max: z.number().int().nonnegative() }).strict(),
]);

const engineConfigSchema = z
  .object({
    planner: functionSchema<Planner>(),
    logger: loggerSchema.optional(),
    history: historySchema.optional(),
    retry: retrySchema.optional(),
  })
  .strict();

// Compile-time drift guard. Each check is a named const so a failure points
// to the specific invariant that drifted. A whole-type reverse check
// (EngineConfig extends inferred) is omitted where the inferred shape can't
// faithfully reproduce the TS side. Key parity + per-field forward checks
// cover add/remove drift and the common value-type drifts.
type _InferredEngineConfig = z.infer<typeof engineConfigSchema>;

const _configKeysSubsetInferred: keyof EngineConfig extends keyof _InferredEngineConfig
  ? true
  : false = true;
const _inferredKeysSubsetConfig: keyof _InferredEngineConfig extends keyof EngineConfig
  ? true
  : false = true;
const _loggerFwd: NonNullable<
  _InferredEngineConfig['logger']
> extends NonNullable<EngineConfig['logger']>
  ? true
  : false = true;
const _retryFwd: NonNullable<
  _InferredEngineConfig['retry']
> extends NonNullable<EngineConfig['retry']>
  ? true
  : false = true;
const _retryBwd: NonNullable<EngineConfig['retry']> extends NonNullable<
  _InferredEngineConfig['retry']
>
  ? true
  : false = true;
void [
  _configKeysSubsetInferred,
  _inferredKeysSubsetConfig,
  _loggerFwd,
  _retryFwd,
  _retryBwd,
];

export function validateEngineConfig(config: unknown): EngineConfig {
  const result = engineConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid EngineConfig: ${formatValidationIssues(result.error)}`,
      {
        cause: result.error,
      },
    );
  }
  // Return the caller's original instance, not `result.data`. Zod's
  // `.object().loose()` rebuilds objects by copying own-enumerable keys,
  // which strips prototype methods from class-based loggers and history
  // stores. The schema is validate-only (no transforms or defaults —
  // defaults are applied in `resolveConfig`), so discarding `result.data`
  // is safe and keeps planner, logger, and history.store identity intact
  // across the validation boundary.
  return config as EngineConfig;
}
