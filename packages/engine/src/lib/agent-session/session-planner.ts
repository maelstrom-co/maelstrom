import type {
  ChartRequest,
  MaelstromResponse,
  MessageId,
  PlannerReasonVerdict,
  Result,
} from '@maelstrom-co/protocol';
import { err, ok } from '@maelstrom-co/protocol';

import type { RunOwner } from '../diagnostics.js';
import type { EngineError } from '../errors.js';
import { validationError } from '../errors.js';
import type { Logger } from '../logger.js';

/** One Planner call made on behalf of an Agent Session. */
export interface SessionPlanInput {
  /** The request to plan. Its `skipReply` decides whether a reply and a clarification are allowed. */
  readonly request: ChartRequest;
  /** Message id of this Planner call. */
  readonly messageId: MessageId;
  /** The run, input and, when one asked, model turn the call's diagnostics belong to. */
  readonly owner: RunOwner;
  /** Aborts the Planner call. */
  readonly signal: AbortSignal;
}

/** What a session Planner call settled on, stripped of Engine diagnostics. */
export type PlanOutcome =
  | {
      readonly type: 'response';
      /** The validated change, with `userMessage` only when the reply is not blank. Never carries verdicts. */
      readonly response: MaelstromResponse;
      /**
       * Verdicts on the request's `user_intent` reasons, kept by validation.
       * A reason without one shares the response's outcome.
       */
      readonly reasons?: readonly PlannerReasonVerdict[];
    }
  | {
      readonly type: 'needs_clarification';
      /** The question the Planner asked instead of planning the whole change. */
      readonly question: string;
      /** Suggested answers to {@link question}. */
      readonly options?: readonly string[];
      /** The healed layout the Planner could already settle, applied before {@link executionPlan}. Absent keeps the current layout. */
      readonly layout?: MaelstromResponse['layout'];
      /** The healed Actions the Planner could already plan, in order. Absent means none. */
      readonly executionPlan?: MaelstromResponse['executionPlan'];
      /**
       * Verdicts on the request's `user_intent` reasons, kept by validation.
       * A reason without one shares the clarification's outcome.
       */
      readonly reasons?: readonly PlannerReasonVerdict[];
    };

/** Plans for one Agent Session. The Engine builds one per connection from its Planner. */
export type SessionPlanner = (
  input: SessionPlanInput,
) => Promise<Result<PlanOutcome, EngineError>>;

/**
 * Takes the response out of a plan outcome for a caller that can only ship a
 * change. A clarification is refused with a `ValidationError` on field
 * `skipReply` and a warning.
 */
export function requireResponse(
  outcome: PlanOutcome,
  messageId: MessageId,
  logger: Logger,
): Result<MaelstromResponse, EngineError> {
  if (outcome.type === 'response') return ok(outcome.response);
  const refused = 'a needs-clarification result';
  logger.warn('Refused a skipReply outcome the Engine cannot ship', {
    messageId,
    outcome: refused,
  });
  return err(
    validationError(
      `skipReply is not supported on this path: the planner returned ${refused}, and a chart_response has no shape for a clarification`,
      'skipReply',
    ),
  );
}
