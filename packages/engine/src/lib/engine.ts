import type {
  ChartRequestMessage,
  ChartResponseOutput,
  EngineMessage,
  EngineOutput,
  MessageId,
  Result,
  RunId,
  SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';
import { err, isErr, ok } from '@maelstrom-co/protocol';
import { operationalKinds } from '@maelstrom-co/telemetry/integration';
import type { ActionParameterEnumSnapshot } from './action-parameter-enum.js';
import { buildActionParameterEnumSnapshot } from './action-parameter-enum.js';
import {
  type AgentConnection,
  createAgentConnection,
  type OpenConnectionOptions,
} from './agent-session/index.js';
import { assertNever } from './assert-never.js';
import { createChartRequestDedup } from './chart-request-dedup.js';
import type { EngineConfig } from './config.js';
import { resolveConfig } from './config.js';
import {
  EngineDiagnosticEmitter,
  type EngineDiagnosticObserver,
  type EngineMetadataObserver,
} from './diagnostics.js';
import type { EngineError } from './errors.js';
import { cancellationError, historyError, validationError } from './errors.js';
import type {
  HistoryManager,
  LLMContextMessage,
} from './history/history-manager.js';
import { createHistoryManager } from './history/history-manager.js';
import type { HistoryEntry } from './history/history-store.js';
import { loadHistoryContext } from './history/load-history-context.js';
import { toSessionHistoryEntry } from './history/wire-projection.js';
import type { Logger } from './logger.js';
import {
  markUnexpectedFailure,
  operationalOutcome,
  thrownOutcome,
  validationFailure,
} from './operational-outcome.js';
import type {
  FullValidatedCandidate,
  FullValidatedPlannerOutput,
  PlannerOutput,
} from './planner/candidate.js';
import { isNeedsClarification } from './planner/candidate.js';
import type {
  ClarifyingPlanner,
  PlanningInput,
  StageContext,
  StageError,
} from './planner/stage.js';
import { isDeferred, unhandledDeferralError } from './planner/stage.js';
import type { CandidateValidator } from './planner/validate-candidate.js';
import { createCandidateValidator } from './planner/validate-candidate.js';
import { withRetry } from './planner/with-retry.js';
import type {
  SkippedAction,
  SkippedActionIdentity,
} from './response/execution-plan/index.js';
import { skippedActionIdentity } from './response/execution-plan/index.js';
import { logAtSeverity } from './severity-router.js';
import { validateEngineConfig } from './validation/engine-config.js';
import {
  logValidationFailure,
  validateEngineMessage,
} from './validation/engine-message.js';
import type { DroppedLayoutEntry } from './validation/llm-output/healed-layout.js';
import {
  formatDroppedEntry,
  formatLayoutWarnings,
  MAX_LOGGED_ENTRIES,
} from './validation/llm-output/healed-layout.js';

function isChartRequestCandidate(message: unknown): boolean {
  try {
    return (
      message !== null &&
      typeof message === 'object' &&
      Object.getOwnPropertyDescriptor(message, 'type')?.value ===
        'chart_request'
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Engine interface
// ---------------------------------------------------------------------------

/**
 * The engine's public surface. Construct via {@link createEngine}.
 *
 * Stateful at the session level: a per-session async mutex inside
 * `HistoryManager` serializes `recordTurn` and the truncation step of
 * `addAssistantMessage` and `clear`; in-process only — multi-instance
 * deployments must close that gap externally, see the README's Concurrency
 * section. The planner call itself is NOT mutex-protected — concurrent
 * `chart_request`s on the same session race their history reads and
 * planner calls; the in-flight dedup Map only collapses identical
 * `(sessionId, messageId)` duplicates, not different requests.
 *
 * Stateless at the request level: a `chart_request` flows history load →
 * planner (optionally retried) → response-processor → history record
 * without retained inter-call state beyond what the configured
 * `HistoryStore` persists.
 *
 * Both safeguards are process-local: multi-instance deployments need
 * deployment-level coordination for history mutations and for identical
 * requests that may reach different instances.
 */
export interface Engine {
  /** Opens an isolated Agent Session with host-authorized identity. The UI-only route does not use the legacy history store. */
  openConnection(options: OpenConnectionOptions): AgentConnection;
  /** Observes development evidence. Overlapping legacy request IDs suppress request-correlated events except engine.request.finished. Run-owned events and metadata observers are unaffected. Hosts must opt in before forwarding. */
  observeDiagnostics?: (observer: EngineDiagnosticObserver) => () => void;
  /** Observes server-local metadata in every environment, without granting content or browser forwarding. */
  observeMetadata?: (observer: EngineMetadataObserver) => () => void;
  /**
   * Routes on `message.type`:
   *
   * - `chart_request` → hands the request and prior history to the
   *   configured planner, heals its candidate against the request (drops
   *   broken pieces, returns a renderable layout), retries per
   *   `EngineConfig.retry` when validation recommends, and records the turn.
   *   Returns `Ok(chart_response)` for renderable outcomes accepted by
   *   `EngineConfig.validatePlan`, when configured (including healed-with-drops).
   * - `assistant_message` → persists developer-supplied content into
   *   session history. Does NOT invoke the planner. Returns
   *   `Ok(assistant_message_result)` with `outcome: 'inserted' | 'deduped'`.
   *
   * `Err` is reserved for genuinely unrecoverable conditions (provider
   * fault, cancellation, prompt-build failure, invalid Action parameter
   * definitions in the Vessel catalog (field `'vessels'`), history error,
   * missing `userMessage`, a planner that deferred with no fallback or
   * threw). A request that set `skipReply: true` still ships only a
   * response with a non-blank `userMessage`: a candidate without one or with
   * a blank one, or a needs-clarification result, is `Err(ValidationError)` on field
   * `'skipReply'`, since a `chart_response` always carries a reply.
   * Invalid `validatePlan` callbacks and unmet application requirements also
   * return `ValidationError` on field `'validatePlan'`.
   * Layout problems heal into diagnostics rather than surfacing here — see
   * {@link EngineDiagnostics} (planner stages see only a summary:
   * `retryHint`, `counts`, rendered `feedback`, and optional `planIssues`;
   * detailed healing records stay internal and are stripped before the response
   * crosses the Engine boundary).
   *
   * `signal` cancels mid-flight: it reaches every planner stage as
   * `StageContext.signal`. A stage that calls a provider is expected to
   * short-circuit a pre-aborted signal to `CancellationError` and to map an
   * abort during the call the same way.
   * A stage that throws after the signal aborted also yields
   * `CancellationError`.
   *
   * **Idempotency.** When `history` is configured on {@link EngineConfig},
   * two duplicate `chart_request` envelopes sharing the same `(sessionId,
   * id)` collapse onto a single planner run: a duplicate that arrives after
   * the original completed replays the stored `chart_response` from
   * history; a duplicate that arrives mid-flight awaits the leader's
   * promise. Failures are not persisted — the next duplicate after a
   * failure reaches the planner as a fresh request. Eviction is bounded by
   * `HistoryManager` truncation only. Without `history` configured, no
   * dedup happens and every request reaches the planner.
   *
   * **Cancellation note for idempotency followers.** A follower (second
   * concurrent caller) that aborts its own `signal` resolves its own await
   * with `Err(CancellationError)`; the leader's planner run continues. If the
   * leader's signal aborts, the leader's promise resolves with
   * `Err(CancellationError)` under the engine contract — an unguarded
   * pipeline throw escapes as `Err(historyError.leaderPipeline)` instead
   * (see the defensive catch in `chart-request-dedup`'s `awaitWithSignal`).
   * Either way, any followers awaiting the leader observe the same `Err`
   * value via the shared promise. Callers that don't want another caller's
   * abort to surface to them must not reuse the `messageId`.
   */
  handle(
    message: EngineMessage,
    signal?: AbortSignal,
  ): Promise<Result<EngineOutput, EngineError>>;

  /**
   * Read the recorded history for a session, projected into the public wire
   * shape. Used by clients that persist a session id and need to rehydrate
   * prior context after a refresh, on a new device, or in a parallel tab.
   *
   * The engine's internal storage record is heavier (full request and
   * response payloads, optional metadata); the returned
   * {@link SessionHistoryEntry} carries only what a chat UI needs to render
   * the conversation. This decoupling lets the engine evolve its storage
   * shape without breaking the wire contract.
   *
   * Lock-free read — does not serialize with concurrent `handle` calls on
   * the same session. Entries are returned in chronological order by
   * envelope `timestamp`, matching {@link HistoryManager.getHistory}.
   *
   * Returns `Err(ValidationError)` when the engine was constructed without
   * a `history` config — the same shape used by `assistant_message` so
   * callers can branch on `_tag` once. Returns `Err(HistoryError)` with
   * `operation: 'get_history'` when the underlying store throws.
   */
  getHistory(
    sessionId: SessionId,
  ): Promise<Result<readonly SessionHistoryEntry[], EngineError>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct an Engine from the given config.
 *
 * Every `chart_request` runs through `config.planner`, wrapped in
 * `withRetry(planner, config.retry)` unless `config.retry` is `false`. The
 * Engine loads history, hands the planner a {@link PlanningInput} and a
 * {@link StageContext}, then heals and validates the returned candidate
 * against the request the client sent, whatever the planner did to its own
 * copy of it. A planner never rejects `handle`: a thrown stage becomes an
 * `Err`, and a `Deferred` nothing recovered becomes
 * `Err(ValidationError)` on field `'planner'`.
 *
 * Unlike `Engine.handle`, which surfaces runtime failures through
 * `Result<…, EngineError>`, this factory validates `config` synchronously
 * and **throws** on invalid input. Invalid config is a programmer error,
 * not a runtime condition — consumers outside TypeScript (or calling with
 * unknown input) should wrap in `try`/`catch`.
 *
 * @throws {Error} If `config` fails Zod validation. The message is prefixed
 *   with `Invalid EngineConfig:` and the original error is attached as
 *   `cause`.
 *
 * @example
 * ```ts
 * // `modelPlanner` is any `Planner`, for example one that calls a model.
 * const engine = createEngine({
 *   planner: modelPlanner,
 *   retry: { max: 2 },
 * });
 * ```
 */
export function createEngine(config: EngineConfig): Engine {
  const diagnosticsEmitter = new EngineDiagnosticEmitter();
  const validated = validateEngineConfig(config);
  const {
    planner: configuredPlanner,
    validatePlan,
    logger,
    history: historyConfig,
    instrument,
    retry,
  } = resolveConfig(validated);
  const planner: ClarifyingPlanner =
    retry === false
      ? configuredPlanner
      : withRetry<PlanningInput>(configuredPlanner, retry);
  const history: HistoryManager | undefined = historyConfig
    ? createHistoryManager(historyConfig)
    : undefined;

  const runChartRequest = async (
    message: ChartRequestMessage,
    signal?: AbortSignal,
    sessionHistory?: readonly LLMContextMessage[],
    runId?: RunId,
  ): Promise<Result<ChartResponseOutput, EngineError>> => {
    const { request } = message;
    const diagnosticOwner = runId ? { runId, inputId: message.id } : message.id;
    logger.debug('Processing chart_request', {
      messageId: message.id,
      sessionId: message.sessionId,
      layoutMode: request.context.layoutMode,
    });

    // Snapshot construction rejects ambiguous or over-limit Action parameter
    // definitions in the Vessel catalog. Surface that as an Err before the
    // planner runs instead of breaking the Promise<Result> contract.
    let enumSnapshot: ActionParameterEnumSnapshot;
    try {
      enumSnapshot = buildActionParameterEnumSnapshot(request.vessels);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Failed to build Action parameter enum snapshot', error, {
        messageId: message.id,
      });
      return err(validationError(errorMessage, 'vessels', error));
    }

    // Prior conversation is what lets the planner reason across turns.
    // Empty when history isn't configured, which planners treat the same as
    // a fresh first turn. A throw from a remote-backed store (Redis blip,
    // Postgres timeout, deserialization error) would otherwise reject the
    // returned promise and break the documented `Promise<Result<…>>`
    // contract — surface it as a HistoryError so callers see the same Err
    // shape they see for assistant_message persistence failures.
    const historyContext =
      sessionHistory !== undefined
        ? ok(sessionHistory)
        : await loadHistoryContext(
            history,
            message.sessionId,
            message.id,
            logger,
          );
    if (isErr(historyContext)) {
      return historyContext;
    }

    const input: PlanningInput = {
      messageId: message.id,
      sessionId: message.sessionId,
      request,
      history: historyContext.value,
    };
    const validate = createCandidateValidator({
      request,
      enumSnapshot,
      messageId: message.id,
      logger,
      validatePlan,
      onValidated: (report) =>
        diagnosticsEmitter.emit(
          message.sessionId,
          diagnosticOwner,
          'engine.candidate.validated',
          { outcome: report.ok ? 'succeeded' : 'failed' },
          () => report,
        ),
    });
    const ctx: StageContext = {
      signal,
      logger,
      instrument: diagnosticsEmitter.instrument(
        instrument,
        message.sessionId,
        diagnosticOwner,
      ),
      origin: input,
      validate,
      enumSnapshot,
    };

    const start = performance.now();
    diagnosticsEmitter.emit(
      message.sessionId,
      diagnosticOwner,
      operationalKinds.enginePlannerStarted,
      {},
      () => input,
    );
    const planned = await runPlanner(planner, input, ctx, validate);
    const durationMs = performance.now() - start;
    const shippable = isErr(planned)
      ? planned
      : requireShippableReply(planned.value, message.id, logger);
    diagnosticsEmitter.emit(
      message.sessionId,
      diagnosticOwner,
      operationalKinds.enginePlannerCompleted,
      {
        durationMs,
        ...operationalOutcome(shippable),
      },
      () => shippable,
    );
    if (isErr(shippable)) {
      return shippable;
    }

    // Strip engine-internal diagnostics before crossing the engine boundary.
    // Anything healed silently here is the only operator-visible signal that
    // the planner produced bad output, so emit a single summary log line —
    // drops and warnings would otherwise be invisible to observability. Severity
    // drives the level so blank-UI responses (`unrecoverable`) cross default
    // `warn`-threshold paging filters.
    const { diagnostics, ...response } = shippable.value;
    diagnosticsEmitter.emit(
      message.sessionId,
      diagnosticOwner,
      'engine.validation.completed',
      {
        dropped: diagnostics.droppedLayoutEntries.length,
        skipped: diagnostics.skippedActions.length,
        warnings: diagnostics.warnings.length,
        retry: diagnostics.retryHint.recommend,
        planIssues: diagnostics.planIssues?.length ?? 0,
      },
      () => diagnostics,
    );
    if (
      diagnostics.skippedActions.length > 0 ||
      diagnostics.droppedLayoutEntries.length > 0 ||
      diagnostics.warnings.length > 0
    ) {
      logAtSeverity(logger, diagnostics.retryHint.severity, 'Response healed', {
        messageId: message.id,
        skippedActions: diagnostics.skippedActions.length,
        droppedLayoutEntries: diagnostics.droppedLayoutEntries.length,
        warnings: diagnostics.warnings.length,
        retrySeverity: diagnostics.retryHint.severity,
        retryRecommend: diagnostics.retryHint.recommend,
        // Two layers: the counts above stay scalar so a log backend can
        // aggregate and alert on them, while `detail` carries the forensic
        // lines — model-derived, bounded, and first to be truncated by a
        // transport that has to cut something.
        detail: {
          drops: formatDroppedEntries(diagnostics.droppedLayoutEntries),
          warnings: formatLayoutWarnings(diagnostics.warnings),
          skips: formatSkippedActions(diagnostics.skippedActions),
        },
      });
    }

    return ok({
      type: 'chart_response',
      sessionId: message.sessionId,
      id: message.id,
      response,
    });
  };

  const dedup = createChartRequestDedup({
    runChartRequest,
    history,
    logger,
  });

  return {
    openConnection: (options) =>
      createAgentConnection(
        options,
        async (input) => {
          const result = await runChartRequest(
            {
              type: 'chart_request',
              id: input.messageId,
              sessionId: options.sessionId,
              timestamp: Date.now(),
              request: input.request,
            },
            input.signal,
            [],
            input.runId,
          );
          return isErr(result) ? result : ok(result.value.response);
        },
        (runId, inputId, kind, metadata, readContent) =>
          diagnosticsEmitter.emit(
            options.sessionId,
            { runId, inputId },
            kind,
            metadata,
            readContent,
          ),
        logger,
      ),
    observeDiagnostics: (observer) => diagnosticsEmitter.subscribe(observer),
    observeMetadata: (observer) =>
      diagnosticsEmitter.subscribeMetadata(observer),
    async handle(rawMessage, signal) {
      const started = performance.now();
      // Wire-format validation runs first. Smart constructors enforce envelope
      // invariants on programmatic construction (timestamp finite, brand
      // non-empty), but wire-deserialized envelopes bypass those constructors.
      // Reject malformed input here so downstream stages (history, planner)
      // can trust the shape.
      const validated = validateEngineMessage(rawMessage);
      if (isErr(validated)) {
        if (isChartRequestCandidate(rawMessage)) {
          diagnosticsEmitter.emitMetadata(
            operationalKinds.engineRequestStarted,
          );
          diagnosticsEmitter.emitMetadata(
            operationalKinds.engineRequestCompleted,
            {
              ...validationFailure,
              durationMs: performance.now() - started,
            },
          );
        }
        logValidationFailure(logger, rawMessage, validated.error);
        return validated;
      }
      const message = validated.value;

      switch (message.type) {
        case 'chart_request': {
          const releaseDiagnostics = diagnosticsEmitter.trackRequest(
            message.sessionId,
            message.id,
          );
          diagnosticsEmitter.emit(
            message.sessionId,
            message.id,
            operationalKinds.engineRequestStarted,
          );
          try {
            const result = await dedup.handle(message, signal);
            diagnosticsEmitter.emit(
              message.sessionId,
              message.id,
              operationalKinds.engineRequestCompleted,
              {
                ...operationalOutcome(result),
                durationMs: performance.now() - started,
              },
            );
            return result;
          } catch (error) {
            diagnosticsEmitter.emit(
              message.sessionId,
              message.id,
              operationalKinds.engineRequestCompleted,
              {
                ...thrownOutcome(signal),
                durationMs: performance.now() - started,
              },
            );
            throw error;
          } finally {
            releaseDiagnostics();
          }
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
              historyError.addAssistantMessage(
                'failed to persist assistant_message',
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

    async getHistory(sessionId) {
      if (history === undefined) {
        return err(validationError('history not configured', 'history'));
      }
      // Two try/catches so the log + error message can distinguish a store
      // failure from a projection failure — both surface the same
      // `operation: 'get_history'` tag (callers shouldn't have to branch on
      // a deeper distinction), but on-call gets a clear signal whether to
      // look at the HistoryStore backend or at a HistoryEntry shape drift.
      let entries: readonly HistoryEntry[];
      try {
        entries = await history.getHistory(sessionId);
      } catch (error) {
        logger.error('Failed to load session history from store', error, {
          op: 'get_history',
          sessionId,
        });
        return err(
          historyError.getHistory(
            'failed to load session history from store',
            error,
          ),
        );
      }
      try {
        return ok(entries.map(toSessionHistoryEntry));
      } catch (error) {
        logger.error(
          'Failed to project session history entry to wire DTO',
          error,
          { op: 'get_history', sessionId },
        );
        return err(
          historyError.getHistory(
            'failed to project session history entry',
            error,
          ),
        );
      }
    },
  };
}

/**
 * Runs the planner and validates its candidate against the original request
 * without letting either reject. A stage error passes through unchanged
 * after one `Planner failed` line, so a custom stage that does not log its
 * own failures still leaves a trace; a value that is not a `Result` becomes
 * `Err(ValidationError)` on field `'planner'`. Validation is cached per candidate, so a candidate a stage
 * already validated through `ctx.validate` (for example inside `withRetry`)
 * is not healed twice.
 */
async function runPlanner(
  planner: ClarifyingPlanner,
  input: PlanningInput,
  ctx: StageContext,
  validate: CandidateValidator,
): Promise<Result<FullValidatedPlannerOutput, EngineError>> {
  try {
    const planned: unknown = await planner(input, ctx);
    if (!isStageResult(planned)) {
      const failure = validationError(
        'planner returned a value that is not a Result<PlannerCandidate, StageError>',
        'planner',
      );
      ctx.logger.error(
        'Planner returned a value that is not a Result',
        failure,
        { messageId: input.messageId },
      );
      return err(failure);
    }
    if (isErr(planned)) {
      const { error } = planned;
      if (!isDeferred(error)) {
        logPlannerFailure(ctx.logger, input.messageId, error);
        return err(error);
      }
      ctx.logger.warn('Planner deferred and nothing recovered the deferral', {
        messageId: input.messageId,
        reason: error.reason,
      });
      return err(unhandledDeferralError(error));
    }
    const report = validate(planned.value);
    if (isErr(report)) return report;
    const issues = report.value.diagnostics.planIssues;
    if (issues !== undefined && issues.length > 0) {
      ctx.logger.warn('Application plan requirements not satisfied', {
        messageId: input.messageId,
        planIssues: issues.length,
      });
      return err(
        validationError(
          'Application plan requirements not satisfied',
          'validatePlan',
          issues,
        ),
      );
    }
    return report;
  } catch (error) {
    return err(plannerThrowError(error, input.messageId, ctx));
  }
}

// A JS stage, or one with a forgotten return, can resolve anything; checking
// here keeps a broken contract from surfacing as an unrelated TypeError or
// escaping handle() as an error value without a _tag.
function isStageResult(
  value: unknown,
): value is Result<PlannerOutput, StageError> {
  if (typeof value !== 'object' || value === null) return false;
  if (!('ok' in value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return 'value' in value;
  if (!('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    typeof error._tag === 'string'
  );
}

// A chart_response always carries a userMessage and has no shape for a
// clarification, so replyless outcomes are refused here rather than widening
// the wire response. Validation accepts these outcomes under skipReply, so
// this is the Engine's ship boundary for them.
function requireShippableReply(
  outcome: FullValidatedPlannerOutput,
  messageId: MessageId,
  logger: Logger,
): Result<FullValidatedCandidate, EngineError> {
  if (isNeedsClarification(outcome)) {
    return refuseReplylessOutcome(
      'a needs-clarification result',
      messageId,
      logger,
    );
  }
  const { userMessage } = outcome;
  if (userMessage === undefined || userMessage.trim() === '') {
    return refuseReplylessOutcome(
      'a response without userMessage',
      messageId,
      logger,
    );
  }
  return ok({ ...outcome, userMessage });
}

function refuseReplylessOutcome(
  outcome: string,
  messageId: MessageId,
  logger: Logger,
): Result<never, EngineError> {
  const failure = validationError(
    `skipReply is not supported on this path: the planner returned ${outcome}, and a chart_response must carry a userMessage`,
    'skipReply',
  );
  logger.warn('Refused a skipReply outcome the Engine cannot ship', {
    messageId,
    outcome,
  });
  return err(failure);
}

// Custom stages may not log their own failures; one line per request keeps
// them from failing silently. Cancellation is expected traffic, not a fault.
function logPlannerFailure(
  logger: Logger,
  messageId: MessageId,
  error: EngineError,
): void {
  const ctx = { messageId, errorTag: error._tag };
  if (error._tag === 'CancellationError') {
    logger.debug('Planner failed', ctx);
    return;
  }
  logger.warn('Planner failed', ctx);
}

/**
 * Maps a stage that broke the never-reject contract to an `EngineError`. A
 * throw under an aborted request signal is a cancellation; anything else,
 * including an `AbortError` from a stage's own timeout or controller, is a
 * planner failure.
 */
function plannerThrowError(
  error: unknown,
  messageId: MessageId,
  { signal, logger }: { signal?: AbortSignal; logger: Logger },
): EngineError {
  if (signal?.aborted) {
    logger.info('Request cancelled', {
      messageId,
      reason: signal.reason,
      thrown: error,
    });
    return cancellationError(
      `Request cancelled: ${signal.reason ?? 'unknown reason'}`,
      signal.reason,
    );
  }
  logger.error('Planner threw', error, { messageId });
  return markUnexpectedFailure(
    validationError(
      error instanceof Error ? error.message : String(error),
      'planner',
      error,
    ),
  );
}

/**
 * Renders the operator-log view of a response's drops under the same list
 * ceiling `formatLayoutWarnings` applies to repairs. A tree the model sizes
 * can drop arbitrarily many entries, so the count in the tail is what keeps
 * the scale of the cut visible.
 */
function formatDroppedEntries(
  entries: readonly DroppedLayoutEntry[],
): string[] {
  const visible = entries.slice(0, MAX_LOGGED_ENTRIES).map(formatDroppedEntry);
  const omitted = entries.length - visible.length;
  if (omitted <= 0) return visible;
  return [
    ...visible,
    `${omitted} additional drop${omitted === 1 ? '' : 's'} omitted`,
  ];
}

/**
 * Renders the operator-log view of a response's refused actions under the
 * same list ceiling drops and repairs use.
 *
 * Structured rather than prose because a skip is the one diagnostic class an
 * operator has to match back to a specific (instance, action) pair, and the
 * scalar count beside it already carries the scale of anything the ceiling
 * cuts.
 */
function formatSkippedActions(
  entries: readonly SkippedAction[],
): SkippedActionIdentity[] {
  return entries.slice(0, MAX_LOGGED_ENTRIES).map(skippedActionIdentity);
}
