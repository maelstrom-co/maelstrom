import type {
  GridPosition,
  GridResponse,
  Result,
  TilingInstance,
  TilingResponse,
} from '@maelstrom-co/protocol';
import {
  err,
  GridResponseSchema,
  ok,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import { chat } from '@tanstack/ai';

import type { EngineConfig } from '../config.js';
import type { EngineError } from '../errors.js';
import { cancellationError, providerError } from '../errors.js';
import type { LLMContextMessage } from '../history/history-manager.js';

// ---------------------------------------------------------------------------
// LLM output type
// ---------------------------------------------------------------------------

export type LLMOutput = GridResponse | TilingResponse;

/**
 * Pre-branded shapes for items inside an {@link LLMOutput} layout. The LLM
 * emits `instanceId` as plain string; layout builders brand it to
 * {@link InstanceId} on the way out. Keeping these types in one place means
 * schema drift only needs one fix.
 */
export type LLMGridPosition = Omit<GridPosition, 'instanceId'> & {
  instanceId: string;
};
export type LLMTilingInstance = Omit<TilingInstance, 'instanceId'> & {
  instanceId: string;
};

// ---------------------------------------------------------------------------
// LLM call — self-contained so process() stays linear
// ---------------------------------------------------------------------------

export async function callLLM(
  adapter: EngineConfig['adapter'],
  systemPrompt: string,
  userPrompt: string,
  outputSchema: typeof GridResponseSchema | typeof TilingResponseSchema,
  historyMessages: readonly LLMContextMessage[],
  signal?: AbortSignal,
): Promise<Result<LLMOutput, EngineError>> {
  const controller = new AbortController();
  const effectiveSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  if (effectiveSignal.aborted) {
    return err(
      cancellationError('Request was already cancelled', signal?.reason),
    );
  }

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
    });
    return ok(output);
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
  }
}
