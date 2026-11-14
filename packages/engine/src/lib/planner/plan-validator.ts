import type { ChartRequest, MaelstromResponse } from '@maelstrom-co/protocol';

/** An application requirement the healed response does not satisfy. */
export interface PlanValidationIssue {
  /** Application-owned identifier for the unmet requirement. */
  readonly code: string;
  /** Actionable feedback for the next planner attempt. */
  readonly message: string;
}

/** Read-only inputs for application-owned plan validation. */
export interface PlanValidationInput {
  /** The original client request, even when a planner narrows its input. */
  readonly request: ChartRequest;
  /**
   * The healed layout and accepted Actions that would reach the client. Under
   * `skipReply: true` its `userMessage` may be absent or blank, and the Engine
   * drops a blank one before shipping.
   */
  readonly response: MaelstromResponse;
}

/**
 * Checks explicit application requirements after Engine healing. Return an empty
 * array to accept the response. Issues join the existing bounded retry feedback;
 * unresolved issues prevent the Engine from shipping the final response.
 * A response to a `skipReply: true` request runs through this hook even when
 * its `userMessage` is absent or blank. Clarification results bypass it, since
 * the Engine refuses them at its delivery boundary.
 *
 * Runs synchronously at most once per candidate object per request. Keep it
 * deterministic and side-effect free; never mutate its inputs. Promises and
 * malformed returns produce a ValidationError without consuming retry budget.
 * The application owns requirement selection; the Engine does not infer intent.
 */
export type PlanValidator = (
  input: PlanValidationInput,
) => readonly PlanValidationIssue[];
