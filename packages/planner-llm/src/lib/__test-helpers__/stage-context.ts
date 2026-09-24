import type {
  ActionParameterEnumSnapshot,
  Logger,
  PlannerCandidate,
  PlanningInput,
  StageContext,
  ValidateCandidate,
} from '@maelstrom-co/engine';
import { buildActionParameterEnumSnapshot } from '@maelstrom-co/engine';
import type { ChartRequest } from '@maelstrom-co/protocol';
import { MessageId, ok, SessionId } from '@maelstrom-co/protocol';

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

/** Validation that accepts every candidate unchanged and recommends nothing. */
export const acceptAll: ValidateCandidate = (candidate: PlannerCandidate) =>
  ok({
    ...(candidate as never as object),
    type: 'maelstrom_response',
    requestId: MessageId('req-1'),
    diagnostics: {
      retryHint: { severity: 'none', recommend: false },
      counts: { skippedActions: 0, droppedLayoutEntries: 0, warnings: 0 },
      feedback: '',
    },
  } as never);

/**
 * A context shaped like the Engine's: `enumSnapshot` is captured from
 * `origin.request.vessels` unless overridden (pass `enumSnapshot: undefined`
 * for a context without one). `validate` accepts everything; `llmPlanner`
 * never calls it, and the Engine's real validator is not part of its public
 * surface.
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
  return {
    origin,
    logger: overrides.logger ?? silentLogger,
    signal: overrides.signal,
    validate: overrides.validate ?? acceptAll,
    enumSnapshot:
      'enumSnapshot' in overrides
        ? overrides.enumSnapshot
        : buildActionParameterEnumSnapshot(origin.request.vessels),
  };
}
