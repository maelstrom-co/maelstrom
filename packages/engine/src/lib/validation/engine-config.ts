import type { AnyTextAdapter } from '@tanstack/ai';
import { z } from 'zod';

import type { EngineConfig } from '../config.js';
import type { LLMContextMessage } from '../history/history-manager.js';
import type { HistoryEntry, HistoryStore } from '../history/history-store.js';
import type { Logger } from '../logger.js';
import type { Planner } from '../planning/contracts.js';

const functionSchema = <T>() =>
  z.custom<T>((value) => typeof value === 'function', {
    message: 'expected function',
  });

const adapterSchema = z
  .object({
    kind: z.literal('text'),
    name: z.string(),
    model: z.string(),
    chatStream: functionSchema<AnyTextAdapter['chatStream']>(),
    structuredOutput: functionSchema<AnyTextAdapter['structuredOutput']>(),
  })
  .loose();

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
const promptOptionsSchema = z
  .object({
    vars: z.record(z.string(), z.string().optional()).optional(),
    system: z.record(z.string(), sectionCustomizerSchema).optional(),
    user: z.record(z.string(), sectionCustomizerSchema).optional(),
  })
  .strict();

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
        (
          entry: HistoryEntry,
          defaults: () => readonly LLMContextMessage[],
        ) => readonly LLMContextMessage[]
      >().optional(),
    store: historyStoreSchema,
  })
  .strict();

const plannerSchema = z
  .object({
    id: z.string().min(1),
    supportedLayoutModes: z.array(z.enum(['grid', 'tiling'])),
    invoke: functionSchema<Planner['invoke']>(),
  })
  .loose();
const routeSchema = z
  .object({
    implementation: plannerSchema,
    finalization: z.enum(['heal-and-ship', 'strict']),
    maxRepairAttempts: z.number().int().nonnegative(),
  })
  .strict();
const fallbackSchema = routeSchema
  .extend({
    on: z
      .array(
        z.enum([
          'deferred',
          'invalid_plan',
          'provider_error',
          'invalid_provider_response',
        ]),
      )
      .min(1),
  })
  .strict();

const adapterConfigSchema = z
  .object({
    adapter: adapterSchema,
    logger: loggerSchema.optional(),
    prompt: promptOptionsSchema.optional(),
    history: historySchema.optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    modelOptions: z.record(z.string(), z.unknown()).optional(),
    operationTimeoutMs: z.number().int().positive().nullable().optional(),
    maxProviderCalls: z.number().int().positive().optional(),
  })
  .strict();
const explicitConfigSchema = z
  .object({
    planner: z
      .object({
        primary: routeSchema,
        fallback: fallbackSchema.optional(),
        operation: z
          .object({
            timeoutMs: z.number().int().positive().nullable(),
            maxProviderCalls: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
    logger: loggerSchema.optional(),
    history: historySchema.optional(),
  })
  .strict();
const engineConfigSchema = z.union([adapterConfigSchema, explicitConfigSchema]);

/** Validates configuration while preserving adapter and logger identity. */
export function validateEngineConfig(config: unknown): EngineConfig {
  const result = engineConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid EngineConfig: ${formatIssues(result.error)}`, {
      cause: result.error,
    });
  }
  return config as EngineConfig;
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map(formatIssue).join('; ');
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  const base = `${path} [${issue.code}]: ${issue.message}`;
  if ('errors' in issue && Array.isArray(issue.errors)) {
    return `${base} (${issue.errors
      .map((branch) => branch.map(formatIssue).join(' & '))
      .join(' | ')})`;
  }
  if ('issues' in issue && Array.isArray(issue.issues)) {
    return `${base} (${issue.issues.map(formatIssue).join(' & ')})`;
  }
  return base;
}
