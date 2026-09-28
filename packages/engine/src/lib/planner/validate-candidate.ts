import type { ChartRequest, MessageId, Result } from '@maelstrom-co/protocol';
import {
  err,
  GridResponseSchema,
  isErr,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { EngineError } from '../errors.js';
import { validationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { ProcessResponseInput } from '../response/response-processor.js';
import { processResponse } from '../response/response-processor.js';
import type { FullValidatedCandidate, PlannerCandidate } from './candidate.js';
import type { ValidateCandidate } from './stage.js';

export interface CandidateValidatorInput {
  readonly request: ChartRequest;
  readonly enumSnapshot: ActionParameterEnumSnapshot;
  readonly messageId: MessageId;
  readonly logger: Logger;
}

/** A {@link ValidateCandidate} whose results keep the full diagnostics. */
export type CandidateValidator = (
  candidate: PlannerCandidate,
) => Result<FullValidatedCandidate, EngineError>;

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
    PlannerCandidate,
    Result<FullValidatedCandidate, EngineError>
  >();
  const validate: CandidateValidator = (candidate) => {
    // A misbehaving stage can hand over a primitive, which a WeakMap cannot
    // key; processing it still yields an Err instead of a throw.
    const cacheable = typeof candidate === 'object' && candidate !== null;
    const cached = cacheable ? cache.get(candidate) : undefined;
    if (cached !== undefined) return cached;
    const result = processCandidate({ ...input, llmOutput: candidate });
    if (cacheable) cache.set(candidate, result);
    return result;
  };
  return validate;
}

// Heal helpers and exhaustiveness guards throw on Engine-internal invariant
// violations; those become Err(ValidationError) on field 'response' so the
// caller's Promise<Result> never rejects.
function processCandidate(
  input: ProcessResponseInput,
): Result<FullValidatedCandidate, EngineError> {
  const { messageId, logger, request, llmOutput } = input;
  const mode = request.context.layoutMode;
  const schema = mode === 'grid' ? GridResponseSchema : TilingResponseSchema;
  const shape = schema.safeParse(llmOutput);
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
