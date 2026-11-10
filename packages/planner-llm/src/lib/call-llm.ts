import type {
  EngineError,
  LLMContextMessage,
  Logger,
  PlannerCandidate,
} from '@maelstrom-co/engine';
import { cancellationError, providerError } from '@maelstrom-co/engine';
import type { MessageId, Result } from '@maelstrom-co/protocol';
import {
  err,
  type GridModelOutput,
  type GridResponse,
  ok,
  type TilingModelOutput,
  type TilingResponse,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter, ChatMiddleware } from '@tanstack/ai';
import { chat, convertSchemaToJsonSchema } from '@tanstack/ai';
import type { z } from 'zod';

/**
 * Sends one structured-output chat call, parses the response with
 * `outputSchema` and returns `toResult` of the parsed output. A parse
 * failure is a `ProviderError`, and `toResult` runs only after a
 * successful parse.
 */
export async function callLLM<OutputSchema extends z.ZodType, Output>(
  adapter: AnyTextAdapter,
  systemPrompt: string,
  userPrompt: string,
  outputSchema: OutputSchema,
  toResult: (parsed: z.output<OutputSchema>) => Output,
  historyMessages: readonly LLMContextMessage[],
  threadId: string,
  signal?: AbortSignal,
  modelOptions?: Record<string, unknown>,
  middleware: ChatMiddleware[] = [],
): Promise<Result<Output, EngineError>> {
  const controller = new AbortController();

  if (signal?.aborted) {
    return err(
      cancellationError('Request was already cancelled', signal?.reason),
    );
  }

  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const output = await chat({
      adapter,
      threadId,
      messages: [
        ...historyMessages,
        { role: 'user' as const, content: userPrompt },
      ],
      systemPrompts: [systemPrompt],
      // TanStack 1.0 stops before terminal usage when its validator rejects a result.
      // Keep provider constraints, then validate locally after the stream drains.
      outputSchema: convertSchemaToJsonSchema(outputSchema),
      stream: false,
      debug: false,
      middleware,
      abortController: controller,
      ...(modelOptions !== undefined && { modelOptions }),
    });
    if (signal?.aborted)
      return err(
        cancellationError(
          'Request cancelled before accepting the response',
          signal.reason,
        ),
      );
    return ok(toResult(outputSchema.parse(output)));
  } catch (error) {
    // Canonical AbortError — unambiguous cancellation
    if (error instanceof DOMException && error.name === 'AbortError') {
      return err(
        cancellationError(
          `Request cancelled: ${signal?.reason ?? 'unknown reason'}`,
          signal?.reason,
        ),
      );
    }

    // Fallback: provider may throw non-DOMException on abort
    if (signal?.aborted) {
      return err(
        cancellationError(
          `Request cancelled: ${signal.reason ?? 'unknown reason'}`,
          signal.reason,
        ),
      );
    }

    return err(
      providerError(
        error instanceof Error ? error.message : String(error),
        error,
      ),
    );
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * Maps parsed reply-bearing model output to the Planner candidate it stands
 * for by stamping `type: 'plan'`.
 */
export function toPlanCandidate(
  parsed: GridModelOutput | TilingModelOutput,
): PlannerCandidate {
  const plan: GridResponse | TilingResponse = { type: 'plan', ...parsed };
  return plan;
}

export function logLLMCallError(
  logger: Logger,
  messageId: MessageId,
  error: EngineError,
): void {
  if (error._tag === 'CancellationError') {
    logger.info('Request cancelled', { messageId, reason: error.reason });
    return;
  }
  // 3-arg form: structured EngineError into the dedicated error slot so
  // _tag, stack, and per-variant context (cause / raw / timeoutMs) reach
  // structured loggers; correlation fields stay in the data slot.
  logger.error('LLM call failed', error, { messageId, errorTag: error._tag });
}
