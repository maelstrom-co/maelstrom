import type { ChartRequest } from '@maelstrom-co/protocol';
import { MessageId, SessionId } from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import { buildActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { Logger } from '../logger.js';
import type {
  PlanningInput,
  StageContext,
  ValidateCandidate,
} from '../planner/stage.js';
import { createCandidateValidator } from '../planner/validate-candidate.js';
import { makeGridRequest, silentLogger } from './fixtures.js';

/** One call recorded by a `spyLogger` logger. */
export interface SpyEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly msg: string;
  readonly error?: unknown;
  readonly ctx?: Record<string, unknown>;
}

/**
 * Creates a logger that records every call, in call order, into the returned
 * `entries` array.
 */
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

/**
 * Builds the `PlanningInput` the Engine hands a planner for `request`, with
 * fixed message and session ids and an empty history. Defaults to
 * `makeGridRequest()`.
 */
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
 * Builds a context the way the Engine does: `validate` runs the real Engine
 * validator against `origin.request` and `enumSnapshot` is the snapshot it
 * checks against. Either can be overridden; pass `enumSnapshot: undefined`
 * for a context without one.
 */
export function makeStageContext(
  overrides: {
    readonly origin?: PlanningInput;
    readonly logger?: Logger;
    readonly signal?: AbortSignal;
    readonly validate?: ValidateCandidate;
    readonly enumSnapshot?: ActionParameterEnumSnapshot;
  } = {},
): StageContext {
  const origin = overrides.origin ?? makePlanningInput();
  const logger = overrides.logger ?? silentLogger;
  const enumSnapshot =
    'enumSnapshot' in overrides
      ? overrides.enumSnapshot
      : buildActionParameterEnumSnapshot(origin.request.vessels);
  return {
    origin,
    logger,
    signal: overrides.signal,
    validate:
      overrides.validate ??
      createCandidateValidator({
        request: origin.request,
        enumSnapshot:
          enumSnapshot ??
          buildActionParameterEnumSnapshot(origin.request.vessels),
        messageId: origin.messageId,
        logger,
      }),
    enumSnapshot,
  };
}
