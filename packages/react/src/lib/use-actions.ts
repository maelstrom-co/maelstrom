import { useEffect } from 'react';
import type { ActionRunner } from '@maelstrom-co/client';

import type { MaelstromContextPair } from './context.js';
import type {
  AnyVesselEntry,
  ExtractVesselByIdFromEntries,
  VesselIds,
} from './vessel-entry-types.js';

/**
 * Factory that creates the m.useActions() hook bound to a specific Maelstrom context.
 *
 * The returned hook registers typed side-effect handlers for actions dispatched to an instance
 * (both engine-initiated and user-initiated via executeAction).
 * Handlers are registered with the CommandProcessor on mount and unregistered on unmount.
 *
 * Pass a stable runner reference (defined outside the component or wrapped in useMemo)
 * to prevent unnecessary re-registrations on each render.
 *
 * Limitation: only one useActions call per instanceId is supported. If two components
 * register runners for the same instanceId, the second overwrites the first, and
 * unmounting either will unregister the active runner.
 */
export function createUseActions<const T extends readonly AnyVesselEntry[]>(
  contextPair: MaelstromContextPair,
) {
  const { useMaelstromContext } = contextPair;

  return function useActions<Id extends VesselIds<T>>(
    // vesselId is unused at runtime but required to narrow ActionRunner<V> to the correct vessel type
    _vesselId: Id,
    instanceId: string,
    runner: ActionRunner<ExtractVesselByIdFromEntries<T, Id>>,
  ): void {
    const { orchestrator } = useMaelstromContext();

    useEffect(() => {
      orchestrator.commandProcessor.registerRunner(
        instanceId,
        runner,
      );

      return () => {
        orchestrator.commandProcessor.unregisterRunner(instanceId);
      };
    }, [orchestrator, instanceId, runner]);
  };
}
