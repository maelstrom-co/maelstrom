import type {
  GridResponse,
  Result,
  TilingResponse,
} from '@maelstrom-co/protocol';
import {
  err,
  type GridResponseSchema,
  ok,
  type TilingResponseSchema,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { chat, StandardSchemaValidationError } from '@tanstack/ai';
import { z } from 'zod';
import type { EngineError } from '../errors.js';
import {
  cancellationError,
  invalidProviderResponseError,
  providerError,
} from '../errors.js';
import type { LLMContextMessage } from '../history/history-manager.js';

// ---------------------------------------------------------------------------
// LLM output type
// ---------------------------------------------------------------------------

export type LLMOutput = GridResponse | TilingResponse;

// ---------------------------------------------------------------------------
// LLM call — self-contained so process() stays linear
// ---------------------------------------------------------------------------

export async function callLLM(
  adapter: AnyTextAdapter,
  systemPrompt: string,
  userPrompt: string,
  outputSchema: typeof GridResponseSchema | typeof TilingResponseSchema,
  historyMessages: readonly LLMContextMessage[],
  signal?: AbortSignal,
  modelOptions?: Record<string, unknown>,
): Promise<Result<LLMOutput, EngineError>> {
  const controller = new AbortController();
  if (signal?.aborted) {
    return err(
      cancellationError('Request was already cancelled', signal.reason),
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
      abortController: controller,
      ...(modelOptions !== undefined && { modelOptions }),
    });
    // @tanstack/ai infers `chat()`'s output from the Zod schema's INPUT type
    // (pre-transform), but at runtime the schema's `.transform(<Brand>)` calls
    // do run during parse, so the value IS branded. Cast to align the type
    // with the runtime contract. The branding-at-parse contract is asserted
    // by the `schema branding` suite in `packages/protocol/src/lib/request.test.ts`.
    return ok(output as LLMOutput);
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

    const validationError = findStructuredOutputValidationError(error);
    if (validationError !== undefined) {
      return err(
        invalidProviderResponseError(
          'provider response failed output validation',
          validationError,
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

function findStructuredOutputValidationError(
  error: unknown,
): unknown | undefined {
  if (
    error instanceof StandardSchemaValidationError ||
    error instanceof z.ZodError
  ) {
    return error;
  }
  if (error instanceof Error && 'cause' in error) {
    const cause = error.cause;
    if (
      cause instanceof StandardSchemaValidationError ||
      cause instanceof z.ZodError
    ) {
      return cause;
    }
  }
  return undefined;
}
