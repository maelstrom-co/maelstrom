import type { ReplylessCandidate } from '@maelstrom-co/engine';
import type { ChartRequest, NeedsClarification } from '@maelstrom-co/protocol';

import type { ParameterAsk } from './types.js';

/**
 * Turns the parameters Jev must ask for into a needs-clarification result
 * that carries the partial plan alongside one question covering every ask.
 *
 * The question holds one sentence per ask, in `asks` order. `options` lists
 * the parameter's enum values only when there is exactly one ask and it
 * declares any. The result carries `partial`'s execution plan when it is
 * non-empty and its layout when it differs from the request's current
 * layout, so with neither it asks the question and leaves the screen as it
 * is.
 */
export function parameterClarification(
  asks: readonly ParameterAsk[],
  partial: ReplylessCandidate,
  request: ChartRequest,
): NeedsClarification {
  const options = asks.length === 1 ? enumOptions(asks[0]) : [];
  const layout = layoutUnchanged(partial, request)
    ? undefined
    : copyLayout(partial);
  return {
    type: 'needs_clarification',
    question: asks.map(askSentence).join(' '),
    ...(options.length > 0 && { options }),
    ...(layout !== undefined && { layout }),
    ...(partial.executionPlan.length > 0 && {
      executionPlan: partial.executionPlan.map((entry) => ({ ...entry })),
    }),
  };
}

function askSentence(ask: ParameterAsk): string {
  return `What should ${ask.parameter.name} be for ${ask.action} on ${ask.instanceId}? (${ask.parameter.description})`;
}

function enumOptions(ask: ParameterAsk | undefined): string[] {
  return (ask?.parameter.enum ?? [])
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .filter((value): value is string => value !== undefined)
    .filter((value) => value.trim().length > 0);
}

function layoutUnchanged(
  partial: ReplylessCandidate,
  request: ChartRequest,
): boolean {
  if (!('tree' in partial.layout) || request.layout.type !== 'tiling')
    return false;
  const { tree, instances } = partial.layout;
  const current = request.layout.tree;
  if (
    tree.length !== current.length ||
    tree.some((token, index) => token !== current[index])
  )
    return false;
  const ids = new Set(instances.map((instance) => instance.instanceId));
  const currentIds = new Set(
    request.instances.map((instance) => instance.instanceId),
  );
  return (
    ids.size === currentIds.size && [...ids].every((id) => currentIds.has(id))
  );
}

function copyLayout(
  partial: ReplylessCandidate,
): NonNullable<NeedsClarification['layout']> {
  if ('tree' in partial.layout)
    return {
      tree: [...partial.layout.tree],
      instances: partial.layout.instances.map((instance) => ({
        ...instance,
      })),
    };
  return {
    positions: partial.layout.positions.map((position) => ({ ...position })),
  };
}
