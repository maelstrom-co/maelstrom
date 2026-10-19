import type {
  ChartRequest,
  MessageId,
  NeedsClarification,
  Result,
} from '@maelstrom-co/protocol';
import {
  err,
  GridResponseSchema,
  GridResponseWithoutReplySchema,
  isErr,
  NeedsClarificationSchema,
  ok,
  TilingResponseSchema,
  TilingResponseWithoutReplySchema,
} from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { EngineError } from '../errors.js';
import { validationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { ProcessResponseInput } from '../response/response-processor.js';
import { processResponse } from '../response/response-processor.js';
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
import { isNeedsClarification } from './candidate.js';
import type { ValidateCandidate } from './stage.js';

export interface CandidateValidatorInput {
  readonly request: ChartRequest;
  readonly enumSnapshot: ActionParameterEnumSnapshot;
  readonly messageId: MessageId;
  readonly logger: Logger;
  /** Called with every report the validator returns, cached ones included. */
  readonly onValidated?: (
    report: Result<FullValidatedPlannerOutput, EngineError>,
  ) => void;
}

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
      result = isNeedsClarification(candidate)
        ? processNeedsClarification(input, candidate)
        : processCandidate({ ...input, llmOutput: candidate });
      if (cacheable) cache.set(candidate, result);
    }
    input.onValidated?.(result);
    return result;
  }
  return validate;
}

const EMPTY_DIAGNOSTICS: FullDiagnostics = Object.freeze({
  skippedActions: Object.freeze([]),
  droppedLayoutEntries: Object.freeze([]),
  warnings: Object.freeze([]),
  retryHint: Object.freeze({ severity: 'none', recommend: false }),
  counts: Object.freeze({
    skippedActions: 0,
    droppedLayoutEntries: 0,
    warnings: 0,
  }),
  feedback: '',
});

// Stages can validate a clarification through ctx.validate, so this check
// rejects one for a request without skipReply before any stage acts on it.
function processNeedsClarification(
  { request, messageId, logger }: CandidateValidatorInput,
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
  const shape = NeedsClarificationSchema.safeParse(output);
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
  return ok({ ...shape.data, diagnostics: EMPTY_DIAGNOSTICS });
}

// Heal helpers and exhaustiveness guards throw on Engine-internal invariant
// violations; those become Err(ValidationError) on field 'response' so the
// caller's Promise<Result> never rejects.
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
  try {
    const processed = processResponse(input);
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

function responseSchemaFor(request: ChartRequest) {
  const replyless = request.skipReply === true;
  if (request.context.layoutMode === 'grid') {
    return replyless ? GridResponseWithoutReplySchema : GridResponseSchema;
  }
  return replyless ? TilingResponseWithoutReplySchema : TilingResponseSchema;
}
