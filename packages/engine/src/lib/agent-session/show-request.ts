import type { ChartRequest } from '@maelstrom-co/protocol';

import type { AgentRunToolPhaseEndedEvent } from './agent-run.js';

/** What one tool phase contributes to the show it asks for. */
export interface ShowFacts {
  /**
   * Names of the tools whose calls succeeded, in call order, repeated when a
   * tool ran more than once.
   */
  readonly toolNames: readonly string[];
}

/**
 * Collects what a settled tool phase contributes to a show. Returns
 * `undefined` when no result succeeded, because only a phase with a
 * successful result asks for a show.
 */
export function collectShowFacts(
  phase: AgentRunToolPhaseEndedEvent,
): ShowFacts | undefined {
  const toolNames = phase.results
    .filter((result) => result.ok)
    .map((result) => result.name);
  return toolNames.length === 0 ? undefined : { toolNames };
}

/**
 * Builds the Planner request for one show from a Chart snapshot. Any
 * client-sent `skipReply` is replaced with `skipReply: true`, and
 * `updateReasons` is replaced with a single `user_intent` reason carrying
 * `intent`.
 */
export function buildShowRequest(
  chart: ChartRequest,
  intent: string,
): ChartRequest {
  return { ...userIntentRequest(chart, intent), skipReply: true };
}

/**
 * Copies a Chart snapshot into a request that plans for one user intent:
 * any client-sent `skipReply` is removed and `updateReasons` is replaced with
 * a single `user_intent` reason carrying `intent`.
 */
export function userIntentRequest(
  chart: ChartRequest,
  intent: string,
): ChartRequest {
  const { skipReply: _skipReply, ...snapshot } = chart;
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      updateReasons: [{ type: 'user_intent', intent }],
    },
  };
}
