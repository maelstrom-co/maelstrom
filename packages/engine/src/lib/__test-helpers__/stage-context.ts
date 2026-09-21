import type { ChartRequest } from '@maelstrom-co/protocol';
import { MessageId, SessionId } from '@maelstrom-co/protocol';

import { buildActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { Logger } from '../logger.js';
import type {
  PlanningInput,
  StageContext,
  ValidateCandidate,
} from '../planner/stage.js';
import { createCandidateValidator } from '../planner/validate-candidate.js';
import { makeGridRequest, silentLogger } from './fixtures.js';

export interface SpyEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly msg: string;
  readonly error?: unknown;
  readonly ctx?: Record<string, unknown>;
}

export function spyLogger(): { logger: Logger; entries: SpyEntry[] } {
  const entries: SpyEntry[] = [];
  const logger: Logger = {
    debug: (msg, ctx) => entries.push({ level: 'debug', msg, ctx }),
    info: (msg, ctx) => entries.push({ level: 'info', msg, ctx }),
    warn: (msg, ctx) => entries.push({ level: 'warn', msg, ctx }),
    error: (msg, error, ctx) =>
      entries.push({ level: 'error', msg, error, ctx }),
  };
  return { logger, entries };
}

export function makePlanningInput(
  request: ChartRequest = makeGridRequest(),
): PlanningInput {
  return {
    messageId: MessageId('req-1'),
    sessionId: SessionId('session-1'),
    request,
    history: [],
  };
}

/**
 * Builds a context whose `validate` runs the real Engine validator against
 * `origin.request`, unless a `validate` override is supplied.
 */
export function makeStageContext(
  overrides: {
    readonly origin?: PlanningInput;
    readonly logger?: Logger;
    readonly signal?: AbortSignal;
    readonly validate?: ValidateCandidate;
  } = {},
): StageContext {
  const origin = overrides.origin ?? makePlanningInput();
  const logger = overrides.logger ?? silentLogger;
  return {
    origin,
    logger,
    signal: overrides.signal,
    validate:
      overrides.validate ??
      createCandidateValidator({
        request: origin.request,
        enumSnapshot: buildActionParameterEnumSnapshot(origin.request.vessels),
        messageId: origin.messageId,
        logger,
      }),
  };
}
