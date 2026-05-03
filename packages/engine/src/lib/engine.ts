import type {
  ChartRequestMessage,
  ChartResponseOutput,
  EngineMessage,
  EngineOutput,
  LayoutMode,
  MessageId,
  Result,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  err,
  GridResponseSchema,
  isErr,
  isOk,
  ok,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';

import { assertNever } from './assert-never.js';
import type { EngineConfig } from './config.js';
import { resolveConfig } from './config.js';
import type { EngineError } from './errors.js';
import { cancellationError, historyError, validationError } from './errors.js';
import type {
  HistoryManager,
  LLMContextMessage,
} from './history/history-manager.js';
import { createHistoryManager } from './history/history-manager.js';
import type { Logger } from './logger.js';
import { callLLM } from './pipeline/call-llm.js';
import { callWithRetry } from './pipeline/retry.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
} from './prompt/prompt-builder.js';
import { processResponse } from './response/response-processor.js';
import { logAtSeverity } from './severity-router.js';
import { validateEngineConfig } from './validation/engine-config.js';
import {
  logValidationFailure,
  validateEngineMessage,
} from './validation/engine-message.js';

// ---------------------------------------------------------------------------
// Engine interface
// ---------------------------------------------------------------------------

/**
 * The engine's public surface. Construct via {@link createEngine}.
 *
 * Stateful at the session level (per-session async mutex serializes
 * `chart_request` processing; in-process only — multi-instance deployments
 * must close that gap externally, see the README's Concurrency section).
 * Stateless at the request level: a `chart_request` flows prompt → LLM →
 * response-processor → optional retry → history record without retained
 * inter-call state beyond what the configured `HistoryStore` persists.
 */
export interface Engine {
  /**
   * Routes on `message.type`:
   *
   * - `chart_request` → builds a prompt from request + prior history,
   *   invokes the LLM, heals the response (drops broken pieces, returns a
   *   renderable layout), optionally retries when heal recommends, and
   *   records the turn. Returns `Ok(chart_response)` for any renderable
   *   outcome (including healed-with-drops).
   * - `assistant_message` → persists developer-supplied content into
   *   session history. Does NOT invoke the LLM. Returns
   *   `Ok(assistant_message_result)` with `outcome: 'inserted' | 'deduped'`.
   *
   * `Err` is reserved for genuinely unrecoverable conditions (provider
   * fault, cancellation, prompt-build failure, history error, missing
   * `userMessage`). Layout problems heal into diagnostics rather than
   * surfacing here — see {@link EngineDiagnostics} (engine-internal,
   * stripped before crossing the boundary).
   *
   * `signal` cancels mid-flight: a pre-aborted signal short-circuits to
   * `CancellationError` without invoking the LLM; an abort during the LLM
   * call is mapped to `CancellationError` via the adapter.
   *
   * **Idempotency.** When `history` is configured on {@link EngineConfig},
   * two duplicate `chart_request` envelopes sharing the same `(sessionId,
   * id)` collapse onto a single LLM call: a duplicate that arrives after
   * the original completed replays the stored `chart_response` from
   * history; a duplicate that arrives mid-flight awaits the leader's
   * promise. Failures are not persisted — the next duplicate after a
   * failure reaches the LLM as a fresh request. Eviction is bounded by
   * `HistoryManager` truncation only. Without `history` configured, no
   * dedup happens and every request reaches the LLM.
   *
   * **Cancellation note for idempotency followers.** A follower (second
   * concurrent caller) that aborts its own `signal` resolves its own await
   * with `Err(CancellationError)`; the leader's LLM call continues. If the
   * leader's signal aborts, the leader's promise resolves with
   * `Err(CancellationError)` (Result-typed; never rejects), and any
   * followers awaiting it observe that same `Err` value via the shared
   * promise. Callers that don't want another caller's abort to surface to
   * them must not reuse the `messageId`.
   */
  handle(
    message: EngineMessage,
    signal?: AbortSignal,
  ): Promise<Result<EngineOutput, EngineError>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct an Engine from the given config.
 *
 * Unlike `Engine.handle`, which surfaces runtime failures through
 * `Result<…, EngineError>`, this factory validates `config` synchronously
 * and **throws** on invalid input. Invalid config is a programmer error,
 * not a runtime condition — consumers outside TypeScript (or calling with
 * unknown input) should wrap in `try`/`catch`.
 *
 * @throws {Error} If `config` fails Zod validation, or if a system-prompt
 *   customizer (`config.prompt.system`) is misconfigured (function on an
 *   unknown key, or a customizer that itself throws). System prompts are
 *   derived once at factory time, so misconfiguration surfaces here rather
 *   than degrading every `chart_request` into a `Result` err. The message
 *   is prefixed with `Invalid EngineConfig:` and the original error is
 *   attached as `cause`.
 */
export function createEngine(config: EngineConfig): Engine {
  const validated = validateEngineConfig(config);
  const {
    adapter,
    logger,
    prompt: promptOptions,
    history: historyConfig,
    maxRetries,
  } = resolveConfig(validated);
  const history: HistoryManager | undefined = historyConfig
    ? createHistoryManager(historyConfig)
    : undefined;

  // System prompts depend only on engine config, so derive them once at
  // factory time and look them up by layoutMode per request. Customizer
  // errors are wrapped in the same `Invalid EngineConfig:` shape the Zod
  // path uses so a single try/catch around `createEngine` catches both.
  let systemPrompts: Record<LayoutMode, string>;
  try {
    systemPrompts = {
      grid: buildSystemPrompt('grid', promptOptions),
      tiling: buildSystemPrompt('tiling', promptOptions),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid EngineConfig: prompt.system: ${message}`, {
      cause: error,
    });
  }

  const runChartRequest = async (
    message: ChartRequestMessage,
    signal?: AbortSignal,
  ): Promise<Result<ChartResponseOutput, EngineError>> => {
    const { request } = message;
    const mode = request.context.layoutMode;
    logger.debug('Processing chart_request', {
      messageId: message.id,
      sessionId: message.sessionId,
      layoutMode: mode,
    });

    const systemPrompt = systemPrompts[mode];

    // buildUserPrompt can throw when a consumer-supplied user-section
    // customizer is misconfigured (function on unknown key) or itself
    // throws. Surface that as an Err instead of breaking the
    // Promise<Result> contract.
    let userPrompt: string;
    try {
      userPrompt = buildUserPrompt(request, promptOptions, logger);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Failed to build user prompt', error, {
        messageId: message.id,
      });
      return err(validationError(errorMessage, 'prompt'));
    }

    const outputSchema =
      mode === 'grid' ? GridResponseSchema : TilingResponseSchema;

    // Prior conversation is what lets the LLM reason across turns.
    // Empty when history isn't configured — callLLM treats that case the
    // same as a fresh first turn. A throw from a remote-backed store
    // (Redis blip, Postgres timeout, deserialization error) would
    // otherwise reject the returned promise and break the documented
    // `Promise<Result<…>>` contract — surface it as a HistoryError so
    // callers see the same Err shape they see for assistant_message
    // persistence failures.
    const historyContext = await loadHistoryContext(
      history,
      message.sessionId,
      message.id,
      logger,
    );
    if (isErr(historyContext)) {
      return historyContext;
    }

    const runOnce = async (
      attemptUserPrompt: string,
      attemptSignal?: AbortSignal,
    ) => {
      const llmResult = await callLLM(
        adapter,
        systemPrompt,
        attemptUserPrompt,
        outputSchema,
        historyContext.value,
        attemptSignal,
      );
      if (isErr(llmResult)) {
        logEngineError(logger, message.id, llmResult.error);
        return llmResult;
      }
      logger.debug('LLM response received', { messageId: message.id });
      // `processResponse` calls heal helpers and `assertNever` defaults that
      // throw on engine-internal contract violations (broken pruner invariant,
      // unknown discriminator arm). Without this catch those throws become
      // unhandled rejections at the engine boundary, breaking the documented
      // `Promise<Result<...>>` contract. Catch synchronously, log with the
      // structured-error slot, and return an Err so callWithRetry can surface
      // it through the same path as any other fatal `EngineError`.
      try {
        const processed = processResponse({
          llmOutput: llmResult.value,
          request,
          messageId: message.id,
          logger,
        });
        if (isErr(processed)) {
          logger.error('Failed to process LLM response', processed.error, {
            messageId: message.id,
          });
        }
        return processed;
      } catch (error) {
        logger.error(
          'Engine invariant violation while processing LLM response',
          error,
          { messageId: message.id },
        );
        return err(
          validationError(
            error instanceof Error ? error.message : String(error),
            'response',
          ),
        );
      }
    };

    const retried = await callWithRetry({
      runOnce,
      originalUserPrompt: userPrompt,
      maxRetries,
      logger,
      signal,
    });
    if (isErr(retried)) {
      return retried;
    }

    // Strip engine-internal diagnostics before crossing the engine boundary.
    // Anything healed silently here is the only operator-visible signal that
    // the LLM produced bad output, so emit a single summary log line — drops
    // and warnings would otherwise be invisible to observability. Severity
    // drives the level so blank-UI responses (`unrecoverable`) cross default
    // `warn`-threshold paging filters.
    const { diagnostics, ...response } = retried.value;
    if (
      diagnostics.skippedActions.length > 0 ||
      diagnostics.droppedLayoutEntries.length > 0 ||
      diagnostics.warnings.length > 0
    ) {
      logAtSeverity(
        logger,
        diagnostics.retryHint.severity,
        'Response healed',
        {
          messageId: message.id,
          skippedActions: diagnostics.skippedActions.length,
          droppedLayoutEntries: diagnostics.droppedLayoutEntries.length,
          warnings: diagnostics.warnings.length,
          retrySeverity: diagnostics.retryHint.severity,
          retryRecommend: diagnostics.retryHint.recommend,
        },
      );
    }

    return ok({
      type: 'chart_response',
      sessionId: message.sessionId,
      id: message.id,
      response,
    });
  };

  const runAndRecord = async (
    message: ChartRequestMessage,
    signal?: AbortSignal,
  ): Promise<Result<ChartResponseOutput, EngineError>> => {
    const result = await runChartRequest(message, signal);
    if (isOk(result) && history !== undefined) {
      // Advisory write: the user already has their response, so a
      // history failure must not retroactively fail the turn.
      try {
        await history.recordTurn(message, result.value);
      } catch (error) {
        logger.error('Failed to record turn', error, {
          messageId: message.id,
          sessionId: message.sessionId,
        });
      }
    }
    return result;
  };

  // Process-local in-flight tracking for chart_request idempotency. Engine-
  // instance-scoped — multi-engine deployments do not coalesce dedup state
  // across instances. A duplicate (sessionId, messageId) that arrives while
  // the leader is still running collapses onto the leader's promise.
  // Cleared on settle, AFTER recordTurn completes inside runAndRecord, so
  // a follower arriving in the post-LLM / pre-recordTurn window still hits
  // the entry instead of starting a duplicate LLM call.
  type InflightKey = `${SessionId}::${MessageId}`;
  const inflight = new Map<
    InflightKey,
    Promise<Result<ChartResponseOutput, EngineError>>
  >();
  const inflightKey = (
    sessionId: SessionId,
    messageId: MessageId,
  ): InflightKey => `${sessionId}::${messageId}`;

  // Followers race the shared leader promise against their own AbortSignal.
  // A follower-side abort resolves only that follower's await with
  // CancellationError; the leader's LLM call continues. If the leader's
  // signal aborts, the leader resolves with Err(CancellationError) (Result-
  // typed; never rejects under engine contract) and followers observe that
  // same Err via the shared promise's resolved value.
  const awaitWithSignal = (
    leaderPromise: Promise<Result<ChartResponseOutput, EngineError>>,
    signal: AbortSignal | undefined,
    sessionId: SessionId,
    messageId: MessageId,
  ): Promise<Result<ChartResponseOutput, EngineError>> => {
    if (signal === undefined) {
      return leaderPromise;
    }
    if (signal.aborted) {
      return Promise.resolve(
        err(cancellationError('aborted by caller', signal.reason)),
      );
    }
    return new Promise((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        resolve(err(cancellationError('aborted by caller', signal.reason)));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      leaderPromise.then(
        (r) => {
          signal.removeEventListener('abort', onAbort);
          resolve(r);
        },
        // Defensive catch-all: leaderPromise is Result-typed and should
        // never reject under contract. If it does (an unguarded throw
        // deeper in the pipeline escapes the per-stage try/catch), we'd
        // otherwise hang every follower forever. Surface as a
        // `leader_pipeline` HistoryError so the follower sees an Err shape
        // and the operator log lets them grep by tag.
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          logger.error('Leader promise rejected unexpectedly', error, {
            sessionId,
            messageId,
          });
          resolve(
            err(
              historyError('leader pipeline threw', 'leader_pipeline', error),
            ),
          );
        },
      );
    });
  };

  return {
    async handle(rawMessage, signal) {
      // Wire-format validation runs first. Smart constructors enforce envelope
      // invariants on programmatic construction (timestamp finite, brand
      // non-empty), but wire-deserialized envelopes bypass those constructors.
      // Reject malformed input here so downstream stages (history, prompt
      // build, LLM call) can trust the shape.
      const validated = validateEngineMessage(rawMessage);
      if (isErr(validated)) {
        logValidationFailure(logger, rawMessage, validated.error);
        return validated;
      }
      const message = validated.value;

      switch (message.type) {
        case 'chart_request': {
          if (history === undefined) {
            return runAndRecord(message, signal);
          }
          // Advisory read: a failed cache lookup must not retroactively fail
          // the turn. Fall through to the in-flight + fresh LLM path — same
          // observable outcome as a cache miss.
          let cached: ChartResponseOutput | null = null;
          try {
            cached = await history.getResponseById(
              message.sessionId,
              message.id,
            );
          } catch (error) {
            logger.error('Failed to look up cached response', error, {
              messageId: message.id,
              sessionId: message.sessionId,
            });
          }
          if (cached !== null) {
            return ok(cached);
          }
          const key = inflightKey(message.sessionId, message.id);
          const existing = inflight.get(key);
          if (existing !== undefined) {
            return awaitWithSignal(
              existing,
              signal,
              message.sessionId,
              message.id,
            );
          }
          const leader = runAndRecord(message, signal);
          inflight.set(key, leader);
          // Two cleanup handlers (not `.finally`) so that an unguarded
          // pipeline throw — which would make `leader` reject rather than
          // resolve to `Err` — is absorbed here: `.then(cleanup, cleanup)`
          // returns a resolved promise either way, while `.finally(cleanup)`
          // would propagate the rejection and emit an unhandledRejection
          // off the `void`-discarded handle. The caller's own `await leader`
          // still surfaces the rejection if one occurs.
          void leader.then(
            () => inflight.delete(key),
            () => inflight.delete(key),
          );
          return leader;
        }
        case 'assistant_message': {
          if (history === undefined) {
            return err(validationError('history not configured', 'history'));
          }
          // Reject injections that alone would exceed the session's char
          // budget. Without this, a single oversized injection would always
          // win the "newest entry retained" rule in truncation and dwarf
          // every subsequent LLM call until something newer pushed it out.
          const maxChars = historyConfig?.maxChars;
          if (maxChars !== undefined && message.content.length > maxChars) {
            return err(
              validationError(
                `assistant_message content (${message.content.length} chars) exceeds maxChars (${maxChars})`,
                'content',
              ),
            );
          }
          // For injections, the history write IS the operation — a failed
          // write means the caller's side effect did not happen, so surface
          // it through the Result channel.
          let inserted: boolean;
          try {
            ({ inserted } = await history.addAssistantMessage(message));
          } catch (error) {
            logger.error('Failed to persist assistant_message', error, {
              messageId: message.id,
              sessionId: message.sessionId,
            });
            return err(
              historyError(
                'failed to persist assistant_message',
                'add_assistant_message',
                error,
              ),
            );
          }
          return ok({
            type: 'assistant_message_result',
            sessionId: message.sessionId,
            id: message.id,
            outcome: inserted ? 'inserted' : 'deduped',
          });
        }
        default:
          // Compile-time exhaustiveness check: fails to compile if a new
          // EngineMessage variant has no `case`. Unreachable at runtime for
          // *unknown* discriminators (validateEngineMessage rejects them
          // upstream); reachable only if a new variant lands in the schema
          // and TS interface but not in this switch.
          return assertNever(message, 'engine.handle');
      }
    },
  };
}

async function loadHistoryContext(
  history: HistoryManager | undefined,
  sessionId: SessionId,
  messageId: MessageId,
  logger: Logger,
): Promise<Result<readonly LLMContextMessage[], EngineError>> {
  if (history === undefined) {
    return ok([]);
  }
  try {
    return ok(await history.getLLMContext(sessionId));
  } catch (error) {
    logger.error('Failed to load history context', error, {
      messageId,
      sessionId,
    });
    return err(
      historyError(
        'failed to load history context',
        'get_llm_context',
        error,
      ),
    );
  }
}

function logEngineError(
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
