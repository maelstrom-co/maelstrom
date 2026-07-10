import { useSyncExternalStore } from 'react';
import type { MaelstromExtension, MaelstromExtensionContext } from '@maelstrom-co/react';
import { useTouchedInstances } from './use-touched-instances';

/**
 * Hooks the demo needs to make orchestration legible (shimmer, action
 * flash, first-run hint) — all of them read `orchestrator.commandProcessor
 * .store`, which isn't part of `m.useMaelstrom()`'s public surface. This
 * mirrors how `maelstromRealtime()` reaches the orchestrator: a
 * `MaelstromExtension` closure, applied via `m.with(...)`, is the supported
 * seam for demo/consumer code to read orchestrator internals without
 * reaching into `@maelstrom-co/react` internals directly.
 */
export interface OrchestrationLegibility {
  /** InstanceIds changed by the most recent engine settle; clears itself after ~1.2s. */
  useTouchedInstances: () => ReadonlySet<string>;
  /** Live count of instances currently on the chart. */
  useInstanceCount: () => number;
}

export const orchestrationLegibility: MaelstromExtension<OrchestrationLegibility> = (
  ctx: MaelstromExtensionContext,
) => ({
  useTouchedInstances: () => {
    const { orchestrator } = ctx.useMaelstromContext();
    return useTouchedInstances(orchestrator.commandProcessor.store);
  },
  useInstanceCount: () => {
    const { orchestrator } = ctx.useMaelstromContext();
    return useSyncExternalStore(
      (onChange) => orchestrator.commandProcessor.store.subscribe(onChange).unsubscribe,
      () => orchestrator.commandProcessor.store.state.instances.size,
    );
  },
});
