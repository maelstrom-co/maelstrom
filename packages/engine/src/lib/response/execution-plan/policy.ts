import type { ChartRequest, InstanceId } from '@maelstrom-co/protocol';
import { isResizeOnlyBatch } from '../../update-reasons.js';

export interface ExecutionPolicy {
  readonly resizeOnly: boolean;
  readonly preExisting: ReadonlySet<InstanceId>;
}

// `preExisting` is read off the request, never off the healed layout: an
// instance the LLM introduces in the same response has no prior state, so the
// action that configures it must stay outside the resize guard.
export function createExecutionPolicy(request: ChartRequest): ExecutionPolicy {
  return {
    resizeOnly: isResizeOnlyBatch(request.context.updateReasons),
    preExisting: new Set(
      request.instances.map((instance) => instance.instanceId),
    ),
  };
}
