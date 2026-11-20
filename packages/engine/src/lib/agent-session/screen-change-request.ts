import type { ChartRequest } from '@maelstrom-co/protocol';

import type { ScreenChangeBatchGoal } from './screen-change-batch.js';

/**
 * Builds the Planner request for one batch of Screen Change goals from a
 * Chart snapshot. Any client-sent `skipReply` is replaced with
 * `skipReply: true`, and `updateReasons` is replaced with one `user_intent`
 * reason per goal, in order, carrying its reason id, goal and referents.
 * Tool call ids stay out of the request.
 */
export function buildScreenChangeRequest(
  chart: ChartRequest,
  goals: readonly ScreenChangeBatchGoal[],
): ChartRequest {
  const { skipReply: _skipReply, ...snapshot } = chart;
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      updateReasons: goals.map(({ reasonId, goal, referents }) => ({
        type: 'user_intent' as const,
        id: reasonId,
        intent: goal,
        ...(referents === undefined ? {} : { referents }),
      })),
    },
    skipReply: true,
  };
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
