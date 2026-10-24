import {
  type CancellationError,
  cancellationError,
  type LLMContextMessage,
  type ProviderError,
  providerError,
  type StageContext,
} from '@maelstrom-co/engine';
import { err, ok, type Result } from '@maelstrom-co/protocol';
import {
  type ChatMiddleware,
  chat,
  convertSchemaToJsonSchema,
} from '@tanstack/ai';
import type { z } from 'zod';
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
 * stays absent. The event excludes prompts, output, errors, and credentials.
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
  let usage: { input?: number; output?: number } | undefined;
  let usageRecorded = false;
  const middleware: ChatMiddleware = {
    // Each provider call gets a fresh snapshot, including separate finalization.
    onConfig: () => {
      usageRecorded = false;
    },
    // onUsage normalizes missing AG-UI counters to zero; retain their presence.
    onChunk: (_ctx, chunk) => {
      if (
        (chunk.type !== 'RUN_FINISHED' && chunk.type !== 'RUN_ERROR') ||
        !chunk.usage ||
        usageRecorded
      )
        return;
      const entries = Array.isArray(chunk.usage)
        ? chunk.usage
        : [
            {
              inputTokens: chunk.usage.promptTokens,
              outputTokens: chunk.usage.completionTokens,
            },
          ];
      for (const entry of entries) {
        usage ??= {};
        if (entry.inputTokens !== undefined) {
          usage.input = (usage.input ?? 0) + entry.inputTokens;
          usageRecorded = true;
        }
        if (entry.outputTokens !== undefined) {
          usage.output = (usage.output ?? 0) + entry.outputTokens;
          usageRecorded = true;
        }
      }
    },
  };
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
      adapter: llm.adapter,
      threadId: sessionId,
      messages: [
        ...recentHistory(history),
        { role: 'user' as const, content: prompt },
      ],
      systemPrompts: [SYSTEM_PROMPT],
      // TanStack 1.0 stops before terminal usage when its validator rejects a result.
      // Keep provider constraints, then validate locally after the stream drains.
      outputSchema: convertSchemaToJsonSchema(schema),
      stream: false,
      debug: false,
      middleware: [middleware],
      abortController: controller,
      ...(llm.modelOptions !== undefined && {
        modelOptions: llm.modelOptions,
      }),
    });
    if (signal?.aborted)
      return cancelled('Request cancelled before accepting the response');
    const parsed = schema.parse(output);
    outcome = 'ok';
    return ok(parsed);
  } catch (error) {
    if (signal?.aborted)
      return cancelled(
        `Request cancelled: ${signal.reason ?? 'unknown reason'}`,
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
      ...(usage?.input !== undefined && {
        'gen_ai.usage.input_tokens': usage.input,
      }),
      ...(usage?.output !== undefined && {
        'gen_ai.usage.output_tokens': usage.output,
      }),
    });
  }
}
