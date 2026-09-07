import type { ChartRequest, InstanceId } from '@maelstrom-co/protocol';

export interface ExecutionPolicy {
  readonly resizeOnly: boolean;
  readonly preExisting: ReadonlySet<InstanceId>;
}

// `preExisting` is read off the request, never off the healed layout: an
// instance the LLM introduces in the same response has no prior state, so the
// action that configures it must stay outside the resize guard. An empty
// reason list is deliberately not `resizeOnly` — `every` alone would call it
// one and guard a turn nothing triggered.
export function createExecutionPolicy(request: ChartRequest): ExecutionPolicy {
  const reasons = request.context.updateReasons;
  return {
    resizeOnly:
      reasons.length > 0 &&
      reasons.every((reason) => reason.type === 'chart_resize'),
    preExisting: new Set(
      request.instances.map((instance) => instance.instanceId),
    ),
  };
}
