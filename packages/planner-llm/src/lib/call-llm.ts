import type {
  EngineError,
  LLMContextMessage,
  Logger,
  PlannerCandidate,
} from '@maelstrom-co/engine';
import { cancellationError, providerError } from '@maelstrom-co/engine';
import type {
  GridResponse,
  MessageId,
  Result,
  TilingResponse,
} from '@maelstrom-co/protocol';
import {
  err,
  type GridResponseSchema,
  ok,
  type TilingResponseSchema,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter, ChatMiddleware } from '@tanstack/ai';
import { chat } from '@tanstack/ai';

export async function callLLM(
  adapter: AnyTextAdapter,
  systemPrompt: string,
  userPrompt: string,
  outputSchema: typeof GridResponseSchema | typeof TilingResponseSchema,
  historyMessages: readonly LLMContextMessage[],
  signal?: AbortSignal,
  modelOptions?: Record<string, unknown>,
  middleware: ChatMiddleware[] = [],
): Promise<Result<PlannerCandidate, EngineError>> {
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
      messages: [
        ...historyMessages,
        { role: 'user' as const, content: userPrompt },
      ],
      systemPrompts: [systemPrompt],
      outputSchema,
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
    // @tanstack/ai infers `chat()`'s output from the Zod schema's INPUT type
    // (pre-transform), but at runtime the schema's `.transform(<Brand>)` calls
    // do run during parse, so the value IS branded. Cast to align the type
    // with the runtime contract. The branding-at-parse contract is asserted
    // by the `schema branding` suite in `packages/protocol/src/lib/request.test.ts`.
    return ok(output as GridResponse | TilingResponse);
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
