import type {
  ChartRequest,
  MessageId,
  NeedsClarification,
  Result,
} from '@maelstrom-co/protocol';
import {
  err,
  GridNeedsClarificationSchema,
  GridResponseSchema,
  GridResponseWithoutReplySchema,
  isErr,
  ok,
  TilingNeedsClarificationSchema,
  TilingResponseSchema,
  TilingResponseWithoutReplySchema,
} from '@maelstrom-co/protocol';
import { z } from 'zod';

import type { ActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { EngineError } from '../errors.js';
import { validationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { ProcessResponseInput } from '../response/response-processor.js';
import {
  buildDiagnostics,
  processPartialChanges,
  processResponse,
} from '../response/response-processor.js';
import { isFixableSkip } from '../validation/llm-output/retry-hint.js';
import type {
  FullDiagnostics,
  FullValidatedCandidate,
  FullValidatedNeedsClarification,
  FullValidatedPlannerOutput,
  FullValidatedReplylessCandidate,
  PlannerCandidate,
  PlannerOutput,
  ReplylessCandidate,
} from './candidate.js';
import type { PlanValidator } from './plan-validator.js';

export interface CandidateValidatorInput {
  readonly request: ChartRequest;
  readonly enumSnapshot: ActionParameterEnumSnapshot;
  readonly messageId: MessageId;
  readonly logger: Logger;
  readonly validatePlan?: PlanValidator;
  /** Called with every report the validator returns, cached ones included. */
  readonly onValidated?: (
    report: Result<FullValidatedPlannerOutput, EngineError>,
  ) => void;
}

const planIssuesSchema = z.array(
  z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
);

/**
 * A {@link ValidateCandidate} whose results keep the full diagnostics. It
 * also accepts a needs-clarification result, which only the Engine passes in.
 */
export interface CandidateValidator {
  (candidate: PlannerCandidate): Result<FullValidatedCandidate, EngineError>;
  (
    candidate: ReplylessCandidate,
  ): Result<FullValidatedReplylessCandidate, EngineError>;
  (candidate: PlannerOutput): Result<FullValidatedPlannerOutput, EngineError>;
}

/**
 * Builds the request-scoped {@link ValidateCandidate}. Each candidate object
 * is processed at most once; later calls with the same object return the
 * same `Result`, so retry decisions and the shipped response share one heal
 * pass and its logs are emitted once.
 */
export function createCandidateValidator(
  input: CandidateValidatorInput,
): CandidateValidator {
  const cache = new WeakMap<
    PlannerOutput,
    Result<FullValidatedPlannerOutput, EngineError>
  >();
  function validate(
    candidate: PlannerCandidate,
  ): Result<FullValidatedCandidate, EngineError>;
  function validate(
    candidate: ReplylessCandidate,
  ): Result<FullValidatedReplylessCandidate, EngineError>;
  function validate(
    candidate: PlannerOutput,
  ): Result<FullValidatedPlannerOutput, EngineError>;
  function validate(
    candidate: PlannerOutput,
  ): Result<FullValidatedPlannerOutput, EngineError> {
    // A misbehaving stage can hand over a primitive, which a WeakMap cannot
    // key; processing it still yields an Err instead of a throw.
    const cacheable = typeof candidate === 'object' && candidate !== null;
    let result = cacheable ? cache.get(candidate) : undefined;
    if (result === undefined) {
      result = validateUncached(input, candidate);
      if (cacheable) cache.set(candidate, result);
    }
    input.onValidated?.(result);
    return result;
  }
  return validate;
}

// A misbehaving stage can hand over a primitive or an object with a missing
// or unknown `type`; each of those is an Err rather than a throw.
function validateUncached(
  input: CandidateValidatorInput,
  candidate: PlannerOutput,
): Result<FullValidatedPlannerOutput, EngineError> {
  if (typeof candidate !== 'object' || candidate === null)
    return rejectUnknownResultType(input, candidate);
  switch (candidate.type) {
    case 'needs_clarification':
      return processNeedsClarification(input, candidate);
    case 'plan':
      return processPlan(input, candidate);
    default: {
      const unknownResult: never = candidate;
      return rejectUnknownResultType(input, unknownResult);
    }
  }
}

function processPlan(
  input: CandidateValidatorInput,
  candidate: ReplylessCandidate,
): Result<FullValidatedReplylessCandidate, EngineError> {
  const processed = processCandidate({ ...input, llmOutput: candidate });
  if (isErr(processed) || input.validatePlan === undefined) return processed;
  return validateApplicationPlan(input, processed.value, input.validatePlan);
}

function rejectUnknownResultType(
  { messageId, logger }: CandidateValidatorInput,
  output: unknown,
): Result<never, EngineError> {
  const type =
    typeof output === 'object' && output !== null && 'type' in output
      ? output.type
      : undefined;
  const failure = validationError(
    `planner result type must be 'plan' or 'needs_clarification', got ${describeType(type)}`,
    'planner',
  );
  logger.error('Planner result has an unknown type', failure, { messageId });
  return err(failure);
}

function describeType(type: unknown): string {
  if (type === undefined) return 'no type';
  return typeof type === 'string' ? `'${type}'` : typeof type;
}

// Stages can validate a clarification through ctx.validate, so this check
// rejects one for a request without skipReply before any stage acts on it.
function processNeedsClarification(
  { request, enumSnapshot, messageId, logger }: CandidateValidatorInput,
  output: NeedsClarification,
): Result<FullValidatedNeedsClarification, EngineError> {
  if (request.skipReply !== true) {
    const failure = validationError(
      'planner returned a needs-clarification result, which requires a request with skipReply: true',
      'planner',
    );
    logger.error(
      'Planner returned a needs-clarification result without skipReply',
      failure,
      { messageId },
    );
    return err(failure);
  }
  const shape = clarificationSchemaFor(request).safeParse(output);
  if (!shape.success) {
    const failure = validationError(
      `planner result does not match the needs-clarification schema: ${shape.error.message}`,
      'planner',
      shape.error,
    );
    logger.error(
      'Planner result does not match the needs-clarification schema',
      failure,
      { messageId },
    );
    return err(failure);
  }
  const { layout, executionPlan, ...clarification } = shape.data;
  const healed = guardInvariants(logger, messageId, () =>
    processPartialChanges({
      request,
      enumSnapshot,
      messageId,
      logger,
      changes: {
        ...(layout === undefined ? {} : { layout }),
        ...(executionPlan === undefined ? {} : { executionPlan }),
      },
    }),
  );
  if (isErr(healed)) return healed;
  const { diagnostics } = healed.value;
  if (hasInvalidPartialChanges(diagnostics)) {
    const failure = validationError(
      `planner clarification carries partial changes that fail plan validation${
        diagnostics.feedback === '' ? '' : `:\n${diagnostics.feedback}`
      }`,
      'planner',
      diagnostics,
    );
    logger.error(
      'Planner clarification carries invalid partial changes',
      failure,
      {
        messageId,
        droppedLayoutCount: diagnostics.counts.droppedLayoutEntries,
        skippedActionCount: diagnostics.counts.skippedActions,
        retryHintSeverity: diagnostics.retryHint.severity,
      },
    );
    return err(failure);
  }
  return ok({ ...clarification, ...healed.value });
}

function validateApplicationPlan(
  input: CandidateValidatorInput,
  processed: FullValidatedReplylessCandidate,
  validatePlan: PlanValidator,
): Result<FullValidatedReplylessCandidate, EngineError> {
  try {
    const { diagnostics, ...response } = processed;
    const returned: unknown = validatePlan({
      request: input.request,
      response,
    });
    // Invalid async hooks must not leave a rejected Promise unobserved.
    if (
      returned !== null &&
      (typeof returned === 'object' || typeof returned === 'function') &&
      'then' in returned
    )
      void Promise.resolve(returned).catch(() => undefined);
    const planIssues = planIssuesSchema.parse(returned);
    return ok({
      ...response,
      diagnostics: buildDiagnostics({
        ...diagnostics,
        planIssues,
        retryHint:
          planIssues.length === 0
            ? diagnostics.retryHint
            : {
                severity:
                  diagnostics.retryHint.severity === 'unrecoverable'
                    ? 'unrecoverable'
                    : 'medium',
                recommend: true,
              },
      }),
    });
  } catch (cause) {
    input.logger.error('Application plan validator failed', cause, {
      messageId: input.messageId,
    });
    return err(
      validationError(
        'Application plan validator failed',
        'validatePlan',
        cause,
      ),
    );
  }
}

function processCandidate(
  input: ProcessResponseInput,
): Result<FullValidatedReplylessCandidate, EngineError> {
  const { messageId, logger, request, llmOutput } = input;
  const mode = request.context.layoutMode;
  const shape = responseSchemaFor(request).safeParse(llmOutput);
  if (!shape.success) {
    const failure = validationError(
      `planner candidate does not match the ${mode} response schema: ${shape.error.message}`,
      'planner',
      shape.error,
    );
    logger.error(
      'Planner candidate does not match the response schema',
      failure,
      { messageId, layoutMode: mode },
    );
    return err(failure);
  }
  return guardInvariants(logger, messageId, () => processResponse(input));
}

// A layout entry healing dropped, an Action skipped for a reason a better
// model answer would avoid, or a layout that would blank a screen with
// Instances on it makes partial changes invalid. Repairs that keep every
// entry, and Actions refused for turn or engine-state reasons, are accepted
// as they are for a plan.
function hasInvalidPartialChanges(diagnostics: FullDiagnostics): boolean {
  return (
    diagnostics.droppedLayoutEntries.length > 0 ||
    diagnostics.retryHint.severity === 'unrecoverable' ||
    diagnostics.skippedActions.some((skip) => isFixableSkip(skip.reason))
  );
}

// Heal helpers and exhaustiveness guards throw on Engine-internal invariant
// violations; those become Err(ValidationError) on field 'response' so the
// caller's Promise<Result> never rejects.
function guardInvariants<T>(
  logger: Logger,
  messageId: MessageId,
  process: () => Result<T, EngineError>,
): Result<T, EngineError> {
  try {
    const processed = process();
    if (isErr(processed)) {
      logger.error('Failed to process LLM response', processed.error, {
        messageId,
      });
    }
    return processed;
  } catch (error) {
    logger.error(
      'Engine invariant violation while processing LLM response',
      error,
      { messageId },
    );
    return err(
      validationError(
        error instanceof Error ? error.message : String(error),
        'response',
        error,
      ),
    );
  }
}

function clarificationSchemaFor(request: ChartRequest) {
  return request.context.layoutMode === 'grid'
    ? GridNeedsClarificationSchema
    : TilingNeedsClarificationSchema;
}

function responseSchemaFor(request: ChartRequest) {
  const replyless = request.skipReply === true;
  if (request.context.layoutMode === 'grid') {
    return replyless ? GridResponseWithoutReplySchema : GridResponseSchema;
  }
  return replyless ? TilingResponseWithoutReplySchema : TilingResponseSchema;
}
