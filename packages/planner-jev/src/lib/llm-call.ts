import {
  type CancellationError,
  cancellationError,
  type LLMContextMessage,
  type ProviderError,
  providerError,
  type StageContext,
} from '@maelstrom-co/engine';
import { err, ok, type Result } from '@maelstrom-co/protocol';
import type { ReportedLlmUsage } from '@maelstrom-co/telemetry/usage';
import { chat, convertSchemaToJsonSchema } from '@tanstack/ai';
import type { z } from 'zod';
import { observeAdapter } from './observe-adapter.js';
import { recentHistory } from './questions.js';
import type { CompletionLlm } from './stages/stage-deps.js';

const SYSTEM_PROMPT = `You write the reply of a dashboard assistant after its planner already decided what to change.
- Describe only what was decided, in one or two short, friendly sentences that read well aloud.
- Do not promise anything the decisions do not include, and never claim that an action listed under "Ask the user" ran.
- When there are values to ask for, ask the user for them in the same reply.
- For each value to fill, give the concrete value the parameter needs, in its type: resolve a landmark, event, or other indirect reference to what it names. Use null only when the request gives no value at all.`;

/**
 * Runs a structured completion with caller cancellation and engine error logging.
 * Reports one `llm.call` event with the model, request correlation, duration,
 * outcome, and the sum of adapter-reported input/output tokens. Missing usage
 * stays absent. Cache reads and writes use `gen_ai.usage.cache_read.input_tokens`
 * and `gen_ai.usage.cache_creation.input_tokens`; `gen_ai.usage.cost` preserves
 * provider-reported monetary cost without price estimates or currency conversion.
 * Cache counters do not change input-token totals.
 * The event excludes prompts, output, errors, and credentials.
 * Counters normalized or omitted by an adapter cannot be recovered here.
 */
export async function callLlm<T>(
  llm: CompletionLlm,
  prompt: string,
  schema: z.ZodType<T>,
  history: readonly LLMContextMessage[],
  ctx: StageContext,
): Promise<Result<T, CancellationError | ProviderError>> {
  const { signal, logger } = ctx;
  const { messageId, sessionId } = ctx.origin;
  const started = performance.now();
  let outcome: 'ok' | 'error' | 'cancelled' = 'error';
  let usage: Partial<Record<keyof ReportedLlmUsage, number>> | undefined;
  let providerAborted = false;
  const adapter = observeAdapter(
    llm.adapter,
    (current) => {
      for (const key of [
        'inputTokens',
        'outputTokens',
        'cachedInputTokens',
        'cacheWriteInputTokens',
        'cost',
      ] as const) {
        const value = current[key];
        if (value === undefined) continue;
        usage ??= {};
        usage[key] = (usage[key] ?? 0) + value;
      }
    },
    () => {
      providerAborted = true;
    },
  );
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const cancelled = (message: string) => {
    outcome = 'cancelled';
    logger.info('Request cancelled', { messageId, reason: signal?.reason });
    return err(cancellationError(message, signal?.reason));
  };
  try {
    if (signal?.aborted) return cancelled('Request was already cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    const output = await chat({
      adapter,
      threadId: sessionId,
      messages: [
        ...recentHistory(history),
        { role: 'user' as const, content: prompt },
      ],
      systemPrompts: [SYSTEM_PROMPT],
      // TanStack 1.0 stops before terminal usage when its validator rejects a result.
      // Keep provider constraints, then validate locally after the stream drains.
      outputSchema: preserveNullableBranches(convertSchemaToJsonSchema(schema)),
      stream: false,
      debug: false,
      abortController: controller,
      ...(llm.modelOptions !== undefined && {
        modelOptions: llm.modelOptions,
      }),
    });
    if (signal?.aborted || providerAborted)
      return cancelled('Request cancelled before accepting the response');
    const parsed = schema.parse(output);
    outcome = 'ok';
    return ok(parsed);
  } catch (error) {
    if (
      signal?.aborted ||
      providerAborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    )
      return cancelled(
        `Request cancelled: ${signal?.reason ?? 'unknown reason'}`,
      );
    const failure = providerError(
      error instanceof Error ? error.message : String(error),
      error,
    );
    logger.error('llmComplete call failed', failure, { messageId });
    return err(failure);
  } finally {
    signal?.removeEventListener('abort', abort);
    ctx.instrument.event('llm.call', {
      'gen_ai.request.model': llm.adapter.model,
      'maelstrom.message_id': messageId,
      'maelstrom.session_id': sessionId,
      'maelstrom.outcome': outcome,
      'maelstrom.latency_ms': performance.now() - started,
      ...(usage?.inputTokens !== undefined && {
        'gen_ai.usage.input_tokens': usage.inputTokens,
      }),
      ...(usage?.outputTokens !== undefined && {
        'gen_ai.usage.output_tokens': usage.outputTokens,
      }),
      ...(usage?.cachedInputTokens !== undefined && {
        'gen_ai.usage.cache_read.input_tokens': usage.cachedInputTokens,
      }),
      ...(usage?.cacheWriteInputTokens !== undefined && {
        'gen_ai.usage.cache_creation.input_tokens': usage.cacheWriteInputTokens,
      }),
      ...(usage?.cost !== undefined && { 'gen_ai.usage.cost': usage.cost }),
    });
  }
}

function preserveNullableBranches(
  schema: ReturnType<typeof convertSchemaToJsonSchema>,
): ReturnType<typeof convertSchemaToJsonSchema> {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value === null || typeof value !== 'object') return value;
    const schemaMaps = new Set([
      'properties',
      'patternProperties',
      '$defs',
      'definitions',
      'dependentSchemas',
    ]);
    const schemas = new Set([
      'items',
      'prefixItems',
      'additionalItems',
      'contains',
      'additionalProperties',
      'unevaluatedProperties',
      'unevaluatedItems',
      'propertyNames',
      'allOf',
      'anyOf',
      'oneOf',
      'not',
      'if',
      'then',
      'else',
      'contentSchema',
    ]);
    const fields: Record<string, unknown> = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        schemaMaps.has(key) &&
        child !== null &&
        typeof child === 'object' &&
        !Array.isArray(child)
          ? Object.fromEntries(
              Object.entries(child).map(([name, schema]) => [
                name,
                normalize(schema),
              ]),
            )
          : schemas.has(key)
            ? normalize(child)
            : child,
      ]),
    );
    if (
      Array.isArray(fields.type) &&
      fields.type.length === 2 &&
      fields.type.includes('null') &&
      fields.type.every((type) => typeof type === 'string') &&
      fields.anyOf === undefined
    ) {
      const { type, ...rest } = fields;
      return { anyOf: type.map((item) => ({ type: item })), ...rest };
    }
    return fields;
  };
  return normalize(schema) as ReturnType<typeof convertSchemaToJsonSchema>;
}
