import type {
  ChartRequest,
  LayoutMode,
  MessageId,
  Result,
} from '@maelstrom-co/protocol';
import {
  err,
  GridResponseSchema,
  isErr,
  ok,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';

import type { ActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import { buildActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { EngineError } from '../errors.js';
import { validationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { PromptOptions } from '../prompt/prompt-builder.js';
import {
  buildSystemPrompt,
  buildUserPromptWithSnapshot,
} from '../prompt/prompt-builder.js';
import { validateLlmPlannerOptions } from '../validation/engine-config.js';
import { callLLM, logLLMCallError } from './call-llm.js';
import type { PlannerCandidate } from './candidate.js';
import { buildRetryPrompt } from './retry-prompt.js';
import type { PlanningInput, Retryable, Stage } from './stage.js';
import { validatorEnumSnapshot } from './validate-candidate.js';

/** Configuration for {@link llmPlanner}. */
export interface LlmPlannerOptions {
  /** TanStack AI text adapter (e.g. `geminiText('gemini-2.0-flash')`, `openaiText('gpt-4o')`). */
  readonly adapter: AnyTextAdapter;
  /** Section-based customization of the system and user prompts. */
  readonly prompt?: PromptOptions;
  /**
   * Provider-specific options forwarded verbatim to every `chat()` call
   * (e.g. `{ max_output_tokens: 16384 }` for an OpenAI adapter). Consult the
   * adapter's provider-options type for the accepted shape.
   */
  readonly modelOptions?: Record<string, unknown>;
}

/**
 * Input accepted by {@link llmPlanner}: a {@link PlanningInput}, optional
 * hints from earlier stages, and optional retry feedback from
 * {@link withRetry}.
 */
export type LlmPlannerInput = Retryable<
  PlanningInput & {
    /**
     * Guidance from earlier stages, rendered verbatim as a `Planner Hints`
     * section at the end of the user prompt. Omitted or empty adds nothing.
     */
    readonly hints?: readonly string[];
  }
>;

/**
 * A planner that asks one LLM for the whole candidate in a single `chat()`
 * call: the system prompt for the request's layout mode, the user prompt
 * serialized from the request (plus any `hints`), prior history, and the
 * layout mode's structured output schema.
 *
 * On a retry from {@link withRetry} the user prompt becomes the original
 * prompt preceded by the previous attempt's diagnostics; the system prompt is
 * unchanged. The original prompt is reused rather than rebuilt, so prompt
 * customizers and serializer warnings run once per request.
 *
 * When the input's Vessel catalog is the one `ctx.validate` checks against,
 * the prompt reuses that validator's Action parameter enum snapshot, so the
 * enum literals the model sees are exactly those validation accepts.
 *
 * Returns `Err(ValidationError)` on field `'prompt'` when the user prompt
 * cannot be built, and the `callLLM` errors (`ProviderError`,
 * `CancellationError`) when the call fails; each is logged. The candidate is
 * returned unvalidated.
 *
 * @throws {Error} If `options` is invalid or a system-prompt customizer is
 *   misconfigured. System prompts are built once here, so the error surfaces
 *   at construction. The message starts with `Invalid LlmPlannerOptions:`
 *   and the original error is attached as `cause`.
 *
 * @example
 * ```ts
 * const planner = llmPlanner({ adapter: openaiText('gpt-4o') });
 * ```
 */
export function llmPlanner(
  options: LlmPlannerOptions,
): Stage<LlmPlannerInput, PlannerCandidate> {
  const {
    adapter,
    prompt = {},
    modelOptions,
  } = validateLlmPlannerOptions(options);

  let systemPrompts: Record<LayoutMode, string>;
  try {
    systemPrompts = {
      grid: buildSystemPrompt('grid', prompt),
      tiling: buildSystemPrompt('tiling', prompt),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid LlmPlannerOptions: prompt.system: ${message}`, {
      cause: error,
    });
  }

  const originalPrompts = new WeakMap<ChartRequest, OriginalPrompt>();

  return async (input, { signal, logger, validate }) => {
    const { request, messageId, hints } = input;
    const mode = request.context.layoutMode;

    const cached = originalPrompts.get(request);
    let userPrompt: string;
    if (
      input.retry !== undefined &&
      cached !== undefined &&
      cached.hints === hints
    ) {
      userPrompt = cached.prompt;
    } else {
      const built = buildOriginalPrompt(
        request,
        hints,
        prompt,
        validatorEnumSnapshot(validate, request.vessels),
        messageId,
        logger,
      );
      if (isErr(built)) return built;
      userPrompt = built.value;
      originalPrompts.set(request, { hints, prompt: userPrompt });
    }

    const result = await callLLM(
      adapter,
      systemPrompts[mode],
      input.retry === undefined
        ? userPrompt
        : buildRetryPrompt(userPrompt, input.retry.diagnostics),
      mode === 'grid' ? GridResponseSchema : TilingResponseSchema,
      input.history,
      signal,
      modelOptions,
    );
    if (isErr(result)) {
      logLLMCallError(logger, messageId, result.error);
      return result;
    }
    logger.debug('LLM response received', { messageId });
    return result;
  };
}

interface OriginalPrompt {
  readonly hints: readonly string[] | undefined;
  readonly prompt: string;
}

function buildOriginalPrompt(
  request: ChartRequest,
  hints: readonly string[] | undefined,
  prompt: PromptOptions,
  enumSnapshot: ActionParameterEnumSnapshot | undefined,
  messageId: MessageId,
  logger: Logger,
): Result<string, EngineError> {
  try {
    const userPrompt = buildUserPromptWithSnapshot(
      request,
      enumSnapshot ?? buildActionParameterEnumSnapshot(request.vessels),
      prompt,
      logger,
    );
    return ok(
      hints === undefined || hints.length === 0
        ? userPrompt
        : `${userPrompt}\n\n${renderHints(hints)}`,
    );
  } catch (error) {
    logger.error('Failed to build user prompt', error, { messageId });
    return err(
      validationError(
        error instanceof Error ? error.message : String(error),
        'prompt',
        error,
      ),
    );
  }
}

function renderHints(hints: readonly string[]): string {
  return ['## Planner Hints', '', ...hints.map((hint) => `- ${hint}`)].join(
    '\n',
  );
}
