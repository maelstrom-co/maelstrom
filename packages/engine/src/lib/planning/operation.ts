import type { ChartRequest, MessageId, Result } from '@maelstrom-co/protocol';
import { err, isErr, ok } from '@maelstrom-co/protocol';

import {
  type ActionParameterEnumSnapshot,
  buildActionParameterEnumSnapshot,
} from '../action-parameter-enum.js';
import type {
  ExplicitPlannerConfig,
  FallbackTrigger,
  PlannerRoute,
} from '../config.js';
import type { EngineError } from '../errors.js';
import {
  cancellationError,
  invalidProviderResponseError,
  planningBudgetExceededError,
  planningDeferredError,
  providerError,
  timeoutError,
  validationError,
} from '../errors.js';
import type {
  LLMContextMessage,
  PlanningHistoryContext,
} from '../history/history-manager.js';
import type { Logger } from '../logger.js';
import type { InternalResponse } from '../response/response-processor.js';
import { logAtSeverity } from '../severity-router.js';
import { createPlanningCallBudget } from './call-budget.js';
import type {
  NormalizedActionEnumEntry,
  PlannerFailure,
  PlannerInvocation,
  PlannerProposal,
  PlanningInput,
} from './contracts.js';
import { finalizeCandidate } from './finalizer.js';

/** Immutable operation snapshot plus the existing enum resolver. */
export interface PlanningSnapshot {
  /** Public immutable planner input. */
  readonly input: PlanningInput;
  /** Existing action parser enum resolver. */
  readonly enumSnapshot: ActionParameterEnumSnapshot;
}

/** Captures and freezes request-derived planning input before asynchronous work. */
export function createPlanningSnapshot(
  request: ChartRequest,
): PlanningSnapshot {
  const sourceEnumSnapshot = buildActionParameterEnumSnapshot(request.vessels);
  const detachedRequest = cloneJsonLike(request) as ChartRequest;
  replaceActionEnums(detachedRequest, request, sourceEnumSnapshot);
  const enumSnapshot = buildActionParameterEnumSnapshot(
    detachedRequest.vessels,
  );
  const actionEnums: NormalizedActionEnumEntry[] = [];
  for (const vessel of detachedRequest.vessels) {
    for (const [variant, definition] of Object.entries(vessel.variants)) {
      for (const action of definition.actions) {
        for (const parameter of action.parameters ?? []) {
          actionEnums.push(
            Object.freeze({
              vesselId: vessel.id,
              variant,
              action: action.name,
              parameter: parameter.name,
              values: Object.freeze(
                enumSnapshot.get(parameter).map((entry) => entry.value),
              ),
            }),
          );
        }
      }
    }
  }
  freezeJson(detachedRequest);
  const input = Object.freeze({
    request: detachedRequest,
    history: Object.freeze({
      structured: Object.freeze([]),
      conversation: Object.freeze([]),
    }),
    actionEnums: Object.freeze(actionEnums),
  });
  return Object.freeze({ input, enumSnapshot });
}

/** Adds a detached history projection without recapturing request-derived input. */
export function withPlanningConversation(
  snapshot: PlanningSnapshot,
  conversation: readonly LLMContextMessage[],
): PlanningSnapshot {
  return withPlanningHistory(snapshot, {
    structured: snapshot.input.history.structured,
    conversation,
  });
}

/**
 * Adds coherent frozen planner views captured from one retained-history read.
 * The stored accepted plan is cloned, never shortened to manufacture prose.
 */
export function withPlanningHistory(
  snapshot: PlanningSnapshot,
  history: PlanningHistoryContext,
): PlanningSnapshot {
  const input = Object.freeze({
    ...snapshot.input,
    history: freezeJson(cloneJsonLike(history)),
  });
  return Object.freeze({ ...snapshot, input });
}

/** Runs the sole engine-owned planning, finalization, repair, and fallback loop. */
export async function executePlanningOperation(input: {
  /** Resolved route configuration. */
  readonly planner: ExplicitPlannerConfig;
  /** Frozen request snapshot and enum resolver. */
  readonly snapshot: PlanningSnapshot;
  /** Response correlation id. */
  readonly messageId: MessageId;
  /** Logger for ordered action validation. */
  readonly logger: Logger;
  /** Caller cancellation signal. */
  readonly signal?: AbortSignal;
}): Promise<Result<InternalResponse, EngineError>> {
  const { planner, snapshot, messageId, logger } = input;
  const startedAt = Date.now();
  let activePlanner = planner.primary.implementation.id;
  let fallbackUsed = false;
  const timeoutMs = planner.operation.timeoutMs;
  const deadlineAt = timeoutMs === null ? undefined : Date.now() + timeoutMs;
  const deadline = new AbortController();
  const timer =
    timeoutMs === null
      ? undefined
      : setTimeout(
          () => deadline.abort('planning deadline exceeded'),
          timeoutMs,
        );
  const signal = input.signal
    ? AbortSignal.any([input.signal, deadline.signal])
    : deadline.signal;
  const context: PlannerInvocation['context'] = {
    signal,
    ...(deadlineAt !== undefined && { deadlineAt }),
    calls: createPlanningCallBudget(
      planner.operation.maxProviderCalls,
      (call, remaining) =>
        logger.info('planning.provider_call', {
          messageId,
          plannerId: activePlanner,
          stage: call.stage,
          fallbackUsed,
          callNumber: planner.operation.maxProviderCalls - remaining,
          remainingProviderCalls: remaining,
        }),
    ),
  };
  const terminal = (): EngineError | undefined => {
    if (input.signal?.aborted) {
      return cancellationError(
        'planning operation cancelled',
        input.signal.reason,
      );
    }
    if (
      deadline.signal.aborted ||
      (deadlineAt !== undefined && Date.now() >= deadlineAt)
    ) {
      if (!deadline.signal.aborted)
        deadline.abort('planning deadline exceeded');
      return timeoutError('planning operation timed out', timeoutMs ?? 0);
    }
    return undefined;
  };
  logger.info('planning.started', {
    messageId,
    plannerId: activePlanner,
    fallbackPlannerId: planner.fallback?.implementation.id ?? null,
  });
  const run = async (): Promise<Result<InternalResponse, EngineError>> => {
    const early = terminal();
    if (early !== undefined) return err(early);
    const primary = await runRoute({
      route: planner.primary,
      snapshot,
      messageId,
      logger,
      context,
      terminal,
      timeoutMs,
    });
    if (primary.ok) return primary;
    const terminalAfterPrimary = terminal();
    if (terminalAfterPrimary !== undefined) return err(terminalAfterPrimary);
    if (isTerminal(primary.error.error)) return err(primary.error.error);
    if (planner.fallback?.on.includes(primary.error.trigger)) {
      if (context.calls.remaining === 0) {
        return err(planningBudgetExceededError());
      }
      logger.warn('planning.fallback', {
        messageId,
        fromPlannerId: activePlanner,
        toPlannerId: planner.fallback.implementation.id,
        reason: primary.error.trigger,
      });
      activePlanner = planner.fallback.implementation.id;
      fallbackUsed = true;
      const fallback = await runRoute({
        route: planner.fallback,
        snapshot,
        messageId,
        logger,
        context,
        terminal,
        timeoutMs,
      });
      const terminalAfterFallback = terminal();
      if (terminalAfterFallback !== undefined)
        return err(terminalAfterFallback);
      return fallback.ok ? fallback : err(fallback.error.error);
    }
    return err(primary.error.error);
  };
  let result: Result<InternalResponse, EngineError> | undefined;
  try {
    result = await run();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    logger.info('planning.completed', {
      messageId,
      plannerId: activePlanner,
      fallbackUsed,
      outcome: result?.ok ? 'success' : 'error',
      ...(result?.ok === false && { errorTag: result.error._tag }),
      providerCalls:
        planner.operation.maxProviderCalls - context.calls.remaining,
      durationMs: Date.now() - startedAt,
    });
  }
}

type RouteFailure = {
  readonly error: EngineError;
  readonly trigger: FallbackTrigger;
};

async function runRoute(input: {
  readonly route: PlannerRoute;
  readonly snapshot: PlanningSnapshot;
  readonly messageId: MessageId;
  readonly logger: Logger;
  readonly context: PlannerInvocation['context'];
  readonly terminal: () => EngineError | undefined;
  readonly timeoutMs: number | null;
}): Promise<Result<InternalResponse, RouteFailure>> {
  const { route, snapshot, messageId, logger, context, terminal, timeoutMs } =
    input;
  const preflight = terminal();
  if (preflight !== undefined)
    return err({ trigger: 'provider_error', error: preflight });
  if (
    !route.implementation.supportedLayoutModes.includes(
      snapshot.input.request.context.layoutMode,
    )
  ) {
    return err({
      trigger: 'deferred',
      error: planningDeferredError(
        'planner does not support requested layout mode',
        'unsupported_capability',
      ),
    });
  }

  let phase: PlannerInvocation['phase'] = { kind: 'initial' };
  for (let repairs = 0; ; ) {
    const beforeInvoke = terminal();
    if (beforeInvoke !== undefined) {
      return err({ trigger: 'provider_error', error: beforeInvoke });
    }
    if (context.calls.remaining === 0) {
      return err({
        trigger: 'provider_error',
        error: planningBudgetExceededError(),
      });
    }
    const proposal = await invoke(
      route,
      snapshot.input,
      phase,
      context,
      terminal,
    );
    const afterInvoke = terminal();
    if (afterInvoke !== undefined) {
      return err({ trigger: 'provider_error', error: afterInvoke });
    }
    if (isErr(proposal))
      return err(failureToRouteError(proposal.error, timeoutMs));
    if (proposal.value.kind === 'deferred') {
      return err({
        trigger: 'deferred',
        error: planningDeferredError('planner deferred', proposal.value.reason),
      });
    }
    const finalized = finalizeCandidate({
      candidate: proposal.value.candidate,
      finalization: route.finalization,
      request: snapshot.input.request,
      enumSnapshot: snapshot.enumSnapshot,
      messageId,
      logger,
    });
    const afterFinalization = terminal();
    if (afterFinalization !== undefined) {
      return err({ trigger: 'provider_error', error: afterFinalization });
    }
    const strictRejected = finalized.kind === 'unusable' || finalized.material;
    const shouldRepair =
      repairs < route.maxRepairAttempts &&
      (route.finalization === 'strict'
        ? strictRejected
        : finalized.kind !== 'unusable' && finalized.report.retryRecommended);
    if (shouldRepair) {
      if (context.calls.remaining === 0) {
        return err({
          trigger: 'provider_error',
          error: planningBudgetExceededError(),
        });
      }
      if (
        route.finalization === 'heal-and-ship' &&
        finalized.kind !== 'unusable'
      ) {
        logRetrying(
          logger,
          finalized.response,
          repairs + 1,
          route.maxRepairAttempts,
        );
      }
      repairs += 1;
      phase = {
        kind: 'repair',
        number: repairs,
        previous: proposal.value.candidate,
        report: finalized.report,
      };
      continue;
    }
    if (
      route.finalization === 'heal-and-ship' &&
      finalized.kind === 'unusable' &&
      finalized.error !== undefined
    ) {
      return err({ trigger: 'provider_error', error: finalized.error });
    }
    if (
      finalized.kind !== 'unusable' &&
      (!strictRejected || route.finalization === 'heal-and-ship')
    ) {
      if (
        route.finalization === 'heal-and-ship' &&
        finalized.report.retryRecommended &&
        route.maxRepairAttempts > 0
      ) {
        logRetriesExhausted(logger, finalized.response, repairs + 1);
      }
      if (
        route.finalization === 'heal-and-ship' &&
        repairs > 0 &&
        !finalized.report.retryRecommended
      ) {
        logger.info('Retry succeeded', {
          attempt: repairs,
          maxRetries: route.maxRepairAttempts,
        });
      }
      return ok(finalized.response);
    }
    return err({
      trigger: 'invalid_plan',
      error: planningDeferredError(
        'planner proposal failed finalization',
        'invalid_plan',
      ),
    });
  }
}

async function invoke(
  route: PlannerRoute,
  input: PlanningInput,
  phase: PlannerInvocation['phase'],
  context: PlannerInvocation['context'],
  terminal: () => EngineError | undefined,
): Promise<Result<PlannerProposal, PlannerFailure>> {
  const early = terminal();
  if (early !== undefined) return err(terminalFailure(early));
  try {
    const pending = route.implementation.invoke({ input, phase, context });
    // A planner may synchronously abort the shared signal before raceAbort
    // installs its handler. Observe its eventual rejection in that case.
    void pending.catch(() => undefined);
    return await raceAbort(pending, context.signal, terminal);
  } catch (cause) {
    return err({
      kind: 'provider_error',
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}

function raceAbort<T>(
  pending: Promise<Result<T, PlannerFailure>>,
  signal: AbortSignal,
  terminal: () => EngineError | undefined,
): Promise<Result<T, PlannerFailure>> {
  const early = terminal();
  if (early !== undefined) return Promise.resolve(err(terminalFailure(early)));
  return new Promise((resolve) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      const failure = terminal();
      resolve(
        err(
          failure === undefined
            ? { kind: 'cancelled', message: 'planning operation cancelled' }
            : terminalFailure(failure),
        ),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (cause) => {
        signal.removeEventListener('abort', onAbort);
        resolve(
          err({
            kind: 'provider_error',
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
        );
      },
    );
  });
}

function terminalFailure(error: EngineError): PlannerFailure {
  switch (error._tag) {
    case 'TimeoutError':
      return { kind: 'timeout', message: error.message, cause: error };
    case 'CancellationError':
      return {
        kind: 'cancelled',
        message: error.message,
        cause: error.reason,
      };
    default:
      throw new Error(
        `Expected a terminal planning error, received ${error._tag}`,
      );
  }
}

function failureToRouteError(
  failure: PlannerFailure,
  timeoutMs: number | null,
): RouteFailure {
  switch (failure.kind) {
    case 'provider_error':
      return {
        trigger: 'provider_error',
        error: providerError(failure.message, failure.cause),
      };
    case 'invalid_provider_response':
      return {
        trigger: 'invalid_provider_response',
        error: invalidProviderResponseError(failure.message, failure.cause),
      };
    case 'budget_exhausted':
      return {
        trigger: 'provider_error',
        error: planningBudgetExceededError(failure.message),
      };
    case 'cancelled':
      return {
        trigger: 'provider_error',
        error: cancellationError(failure.message, failure.cause),
      };
    case 'timeout':
      return {
        trigger: 'provider_error',
        error: timeoutError(failure.message, timeoutMs ?? 0),
      };
    case 'validation_error':
      return {
        trigger: 'provider_error',
        error: validationError(failure.message, 'prompt', failure.cause),
      };
  }
}

function isTerminal(error: EngineError): boolean {
  return (
    error._tag === 'CancellationError' ||
    error._tag === 'TimeoutError' ||
    error._tag === 'PlanningBudgetExceededError'
  );
}

function logRetrying(
  logger: Logger,
  response: InternalResponse,
  attempt: number,
  maxRetries: number,
): void {
  logAtSeverity(
    logger,
    response.diagnostics.retryHint.severity,
    'Retrying after recommended retry',
    {
      attempt,
      maxRetries,
      retrySeverity: response.diagnostics.retryHint.severity,
      droppedLayoutCount: response.diagnostics.droppedLayoutEntries.length,
      skippedActionCount: response.diagnostics.skippedActions.length,
      warningCount: response.diagnostics.warnings.length,
    },
  );
}

function logRetriesExhausted(
  logger: Logger,
  response: InternalResponse,
  attempts: number,
): void {
  logAtSeverity(
    logger,
    response.diagnostics.retryHint.severity,
    'Retries exhausted',
    {
      attempts,
      retrySeverity: response.diagnostics.retryHint.severity,
      droppedLayoutCount: response.diagnostics.droppedLayoutEntries.length,
      skippedActionCount: response.diagnostics.skippedActions.length,
      warningCount: response.diagnostics.warnings.length,
    },
  );
}

function replaceActionEnums(
  target: ChartRequest,
  source: ChartRequest,
  sourceSnapshot: ActionParameterEnumSnapshot,
): void {
  for (
    let vesselIndex = 0;
    vesselIndex < target.vessels.length;
    vesselIndex += 1
  ) {
    const targetVessel = target.vessels[vesselIndex];
    const sourceVessel = source.vessels[vesselIndex];
    if (targetVessel === undefined || sourceVessel === undefined) continue;
    for (const [variant, targetVariant] of Object.entries(
      targetVessel.variants,
    )) {
      const sourceVariant = Object.entries(sourceVessel.variants).find(
        ([sourceVariant]) => sourceVariant === variant,
      )?.[1];
      if (sourceVariant === undefined) continue;
      for (
        let actionIndex = 0;
        actionIndex < targetVariant.actions.length;
        actionIndex += 1
      ) {
        const targetAction = targetVariant.actions[actionIndex];
        const sourceAction = sourceVariant.actions[actionIndex];
        if (targetAction === undefined || sourceAction === undefined) continue;
        for (
          let parameterIndex = 0;
          parameterIndex < (targetAction.parameters?.length ?? 0);
          parameterIndex += 1
        ) {
          const targetParameter = targetAction.parameters?.[parameterIndex];
          const sourceParameter = sourceAction.parameters?.[parameterIndex];
          if (targetParameter === undefined || sourceParameter === undefined)
            continue;
          if (sourceParameter.enum !== undefined) {
            (targetParameter as { enum?: unknown[] }).enum = sourceSnapshot
              .get(sourceParameter)
              .map((entry) => entry.value);
          }
        }
      }
    }
  }
}

function cloneJsonLike<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneJsonLike) as T;
  const copy: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== 'function') copy[key] = cloneJsonLike(child);
  }
  return copy as T;
}

function freezeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const pending: object[] = [value as object];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') pending.push(child);
    }
    Object.freeze(current);
  }
  return value;
}
