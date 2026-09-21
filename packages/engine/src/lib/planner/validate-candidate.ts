import type { ChartRequest, MessageId, Result } from '@maelstrom-co/protocol';
import { err, isErr } from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { EngineError } from '../errors.js';
import { validationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type {
  InternalResponse,
  ProcessResponseInput,
} from '../response/response-processor.js';
import { processResponse } from '../response/response-processor.js';
import type {
  PlannerCandidate,
  ValidateCandidate,
  ValidatedCandidate,
} from './stage.js';

export interface CandidateValidatorInput {
  readonly request: ChartRequest;
  readonly enumSnapshot: ActionParameterEnumSnapshot;
  readonly messageId: MessageId;
  readonly logger: Logger;
}

/**
 * Builds the request-scoped {@link ValidateCandidate}. Each candidate object
 * is processed at most once; later calls with the same object return the
 * same `Result`, so retry decisions and the shipped response share one heal
 * pass and its logs are emitted once.
 */
export function createCandidateValidator(
  input: CandidateValidatorInput,
): ValidateCandidate {
  const cache = new WeakMap<
    PlannerCandidate,
    Result<ValidatedCandidate, EngineError>
  >();
  return (candidate) => {
    const cached = cache.get(candidate);
    if (cached !== undefined) return cached;
    const result = processCandidate({ ...input, llmOutput: candidate });
    cache.set(candidate, result);
    return result;
  };
}

/**
 * Runs `processResponse` without letting it reject the caller's
 * `Promise<Result>`: heal helpers and exhaustiveness guards throw on
 * Engine-internal invariant violations, and those become
 * `Err(ValidationError)` on field `'response'`.
 */
export function processCandidate(
  input: ProcessResponseInput,
): Result<InternalResponse, EngineError> {
  const { messageId, logger } = input;
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
