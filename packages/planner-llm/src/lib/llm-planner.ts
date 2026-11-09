import type {
  ActionParameterEnumSnapshot,
  EngineError,
  Logger,
  PlannerCandidate,
  PlannerOutput,
  PlanningInput,
  ReplylessCandidate,
  Retryable,
  Stage,
} from '@maelstrom-co/engine';
import {
  buildActionParameterEnumSnapshot,
  cancellationError,
  enumSnapshotFor,
  validationError,
} from '@maelstrom-co/engine';
import type {
  ChartRequest,
  LayoutMode,
  MessageId,
  Result,
} from '@maelstrom-co/protocol';
import {
  err,
  GridModelOutputSchema,
  isErr,
  ok,
  TilingModelOutputSchema,
} from '@maelstrom-co/protocol';
import type { ReportedLlmUsage } from '@maelstrom-co/telemetry/usage';
import type { AnyTextAdapter } from '@tanstack/ai';
import type { z } from 'zod';

import { callLLM, logLLMCallError, toPlanCandidate } from './call-llm.js';
import { observeAdapter } from './observe-adapter.js';
import type { PromptOptions } from './prompt/prompt-builder.js';
import {
  buildReplylessSystemPrompt,
  buildSystemPrompt,
  buildUserPromptWithSnapshot,
} from './prompt/prompt-builder.js';
import { buildRetryPrompt } from './retry-prompt.js';
import {
  skipReplyOutputSchemaFor,
  toPlannerOutput,
} from './skip-reply-output.js';
import { validateLlmPlannerOptions } from './validate-options.js';

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
 * Input accepted by {@link llmPlanner}: the engine's `PlanningInput`,
 * optional hints from earlier stages, and optional retry feedback from the
 * engine's `withRetry`.
 */
export type LlmPlannerInput = Retryable<LlmPlanningInput>;

/**
 * Input accepted by {@link clarifyingLlmPlanner}: the same as
 * {@link LlmPlannerInput}, except that the retry feedback may carry a
 * {@link ReplylessCandidate} from the previous attempt, so the planner fits
 * `withRetry` for a stage that returns any `PlannerOutput`.
 */
export type ClarifyingLlmPlannerInput = Retryable<
  LlmPlanningInput,
  ReplylessCandidate
>;

/**
 * A planner that asks one LLM for the whole candidate in a single `chat()`
 * call: the system prompt for the request's layout mode, the user prompt
 * serialized from the request (plus any `hints`), prior history, and the
 * layout mode's structured output schema (`GridModelOutputSchema` or
 * `TilingModelOutputSchema`). That schema has no `type` field, so the model
 * never writes it. The parsed reply is returned tagged `type: 'plan'`.
 *
 * On a retry from the engine's `withRetry` the user prompt becomes the original
 * prompt preceded by the previous attempt's diagnostics; the system prompt is
 * unchanged. The original prompt is reused rather than rebuilt, so prompt
 * customizers and serializer warnings run once per request.
 *
 * When the input's Vessel catalog is the one in `ctx.origin`, the prompt
 * reuses `ctx.enumSnapshot`, so the enum literals the model sees are exactly
 * those validation accepts. Any other catalog gets a fresh snapshot.
 *
 * Returns `Err(ValidationError)` on field `'prompt'` when the user prompt
 * cannot be built, and the `callLLM` errors (`ProviderError`,
 * `CancellationError`) when the call fails; each is logged. The candidate is
 * returned unvalidated.
 *
 * Each model call is reported to `ctx.instrument` as an `llm.call` event
 * with `gen_ai.request.model` (the adapter's model), `maelstrom.outcome`
 * (`ok`, `error` or `cancelled`), `maelstrom.latency_ms`, and the origin's
 * `maelstrom.message_id` and `maelstrom.session_id`. Adapter-reported usage
 * is summed across model calls as `gen_ai.usage.input_tokens` and
 * `gen_ai.usage.output_tokens`. Cache reads and writes use
 * `gen_ai.usage.cache_read.input_tokens` and
 * `gen_ai.usage.cache_creation.input_tokens`; provider-reported monetary cost
 * uses `gen_ai.usage.cost`, without price estimates or currency conversion.
 * Cache counters do not change input-token totals. Missing usage remains absent.
 * Prompts, output, provider errors, and credentials never appear in these events. Counters
 * normalized or omitted by an adapter cannot be recovered here.
 *
 * It ignores the request's `skipReply` flag and always asks for a reply; use
 * {@link clarifyingLlmPlanner} for a planner that honours it.
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
  return createLlmPlanner(options, replyBearingModelCalls);
}

/**
 * A planner that honours the request's `skipReply` flag and may answer with a
 * needs-clarification result. It returns the skipReply arm of the protocol's
 * `PlannerOutputFor`: a tagged plan without `userMessage`, or a
 * `NeedsClarification`.
 *
 * Without the flag, or with `skipReply: false`, it behaves exactly like
 * {@link llmPlanner}: the same system prompt, user prompt, structured output
 * schema and tagged, reply-bearing candidate.
 *
 * With `skipReply: true` it sends a system prompt that never asks for a reply
 * and a structured output schema without `userMessage` but with an optional
 * `clarification` (a `question` and optional `options`). Output without a
 * clarification is returned as a plan tagged `type: 'plan'` with no
 * `userMessage` key. Output with one is returned as a `NeedsClarification`
 * whose `layout` and `executionPlan` are the partial changes the model filled
 * for the parts of the request that are already clear. A request the planner
 * cannot fulfil comes back as a clarification that names the gap and offers
 * the closest supported options.
 *
 * The user prompt, hints, enum snapshot reuse, retry prompt, instrumentation
 * and error mapping are those of {@link llmPlanner}; on a retry the system
 * prompt and schema stay those of the request's mode and flag.
 *
 * @throws {Error} If `options` is invalid or a system-prompt customizer is
 *   misconfigured. The default and reply-free system prompts for both layout
 *   modes are built once here, so the error surfaces at construction. The
 *   message starts with `Invalid LlmPlannerOptions:` and the original error
 *   is attached as `cause`.
 *
 * @example
 * ```ts
 * const engine = createEngine({
 *   planner: withRetry(clarifyingLlmPlanner({ adapter: openaiText('gpt-4o') }), {
 *     max: 1,
 *   }),
 * });
 * ```
 */
export function clarifyingLlmPlanner(
  options: LlmPlannerOptions,
): Stage<ClarifyingLlmPlannerInput, PlannerOutput> {
  return createLlmPlanner<PlannerOutput>(options, (prompt) => {
    const replyBearing = replyBearingModelCalls(prompt);
    const replylessSystemPrompts: Record<LayoutMode, string> = {
      grid: buildReplylessSystemPrompt('grid', prompt),
      tiling: buildReplylessSystemPrompt('tiling', prompt),
    };
    return (request, send) => {
      if (request.skipReply !== true) return replyBearing(request, send);
      const mode = request.context.layoutMode;
      return send(
        replylessSystemPrompts[mode],
        skipReplyOutputSchemaFor(mode),
        toPlannerOutput,
      );
    };
  });
}

interface LlmPlanningInput extends PlanningInput {
  /**
   * Guidance from earlier stages, rendered verbatim as a `Planner Hints`
   * section at the end of the user prompt. Omitted or empty adds nothing.
   */
  readonly hints?: readonly string[];
}

type SendModelCall = <OutputSchema extends z.ZodType, Output>(
  systemPrompt: string,
  outputSchema: OutputSchema,
  toResult: (parsed: z.output<OutputSchema>) => Output,
) => Promise<Result<Output, EngineError>>;

type ModelCallForRequest<Output> = (
  request: ChartRequest,
  send: SendModelCall,
) => Promise<Result<Output, EngineError>>;

type BuildModelCalls<Output> = (
  prompt: PromptOptions,
) => ModelCallForRequest<Output>;

function replyBearingModelCalls(
  prompt: PromptOptions,
): ModelCallForRequest<PlannerCandidate> {
  const systemPrompts: Record<LayoutMode, string> = {
    grid: buildSystemPrompt('grid', prompt),
    tiling: buildSystemPrompt('tiling', prompt),
  };
  return (request, send) => {
    const mode = request.context.layoutMode;
    return send(
      systemPrompts[mode],
      mode === 'grid' ? GridModelOutputSchema : TilingModelOutputSchema,
      toPlanCandidate,
    );
  };
}

function createLlmPlanner<Output extends PlannerOutput>(
  options: LlmPlannerOptions,
  buildModelCalls: BuildModelCalls<Output>,
): Stage<ClarifyingLlmPlannerInput, Output> {
  const {
    adapter,
    prompt = {},
    modelOptions,
  } = validateLlmPlannerOptions(options);

  let modelCallFor: ModelCallForRequest<Output>;
  try {
    modelCallFor = buildModelCalls(prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid LlmPlannerOptions: prompt.system: ${message}`, {
      cause: error,
    });
  }

  const originalPrompts = new WeakMap<ChartRequest, OriginalPrompt>();

  return async (input, ctx) => {
    const { signal, logger } = ctx;
    const { request, messageId, hints } = input;

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
        enumSnapshotFor(ctx, request.vessels),
        messageId,
        logger,
      );
      if (isErr(built)) return built;
      userPrompt = built.value;
      originalPrompts.set(request, { hints, prompt: userPrompt });
    }

    const started = performance.now();
    let usage: Partial<Record<keyof ReportedLlmUsage, number>> | undefined;
    let providerAborted = false;
    const observedAdapter = observeAdapter(
      adapter,
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
    const outgoingUserPrompt =
      input.retry === undefined
        ? userPrompt
        : buildRetryPrompt(userPrompt, input.retry.diagnostics);
    const received = await modelCallFor(
      request,
      (systemPrompt, outputSchema, toResult) =>
        callLLM(
          observedAdapter,
          systemPrompt,
          outgoingUserPrompt,
          outputSchema,
          toResult,
          input.history,
          ctx.origin.sessionId,
          signal,
          modelOptions,
        ),
    );
    const result = providerAborted
      ? err(cancellationError('Provider call was cancelled', signal?.reason))
      : received;
    ctx.instrument.event('llm.call', {
      'gen_ai.request.model': adapter.model,
      'maelstrom.message_id': ctx.origin.messageId,
      'maelstrom.session_id': ctx.origin.sessionId,
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
      'maelstrom.outcome': isErr(result)
        ? result.error._tag === 'CancellationError'
          ? 'cancelled'
          : 'error'
        : 'ok',
      'maelstrom.latency_ms': performance.now() - started,
    });
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
