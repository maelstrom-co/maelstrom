import type { Result } from '@maelstrom-co/protocol';
import { err, ok } from '@maelstrom-co/protocol';
import type { GridResponse, TilingResponse } from '@maelstrom-co/protocol-old';
import {
  GridResponseSchema,
  TilingResponseSchema,
} from '@maelstrom-co/protocol-old';
import { chat } from '@tanstack/ai';

import type { EngineConfig } from '../config.js';
import type { EngineError } from '../errors.js';
import { cancellationError, providerError } from '../errors.js';

// ---------------------------------------------------------------------------
// LLM output type
// ---------------------------------------------------------------------------

export type LLMOutput = GridResponse | TilingResponse;

// ---------------------------------------------------------------------------
// LLM call — self-contained so process() stays linear
// ---------------------------------------------------------------------------

export async function callLLM(
  adapter: EngineConfig['adapter'],
  systemPrompt: string,
  userPrompt: string,
  outputSchema: typeof GridResponseSchema | typeof TilingResponseSchema,
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
      messages: [{ role: 'user' as const, content: userPrompt }],
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
