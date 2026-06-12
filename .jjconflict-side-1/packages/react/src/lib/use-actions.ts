import { useEffect } from 'react'
import { useStore } from '@tanstack/react-store'
import type { ActionRunner } from '@maelstrom-co/client'
import { InstanceId } from '@maelstrom-co/protocol'

import type { MaelstromContextPair } from './context.js'
import type { AnyVesselEntry, ExtractVesselByIdFromEntries, VesselIds, } from './vessel-entry-types.js'
import { warnOnce } from './warn-once.js'

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
 * register runners for the same instanceId, the second overwrites the first.
 * Disposal is identity-checked, so unmounting the first will not affect the second's runner.
 */
export function createUseActions<const T extends readonly AnyVesselEntry[]>(
  contextPair: MaelstromContextPair,
) {
  const { useMaelstromContext } = contextPair;

  return function useActions<Id extends VesselIds<T>>(
    vesselId: Id,
    instanceId: string,
    runner: ActionRunner<ExtractVesselByIdFromEntries<T, Id>>,
  ): void {
    const { orchestrator } = useMaelstromContext();

    // Brand once at the React seam — the hook accepts a raw string (caller
    // ergonomics) but downstream APIs are branded.
    const brandedInstanceId = InstanceId(instanceId);

    const instance = useStore(orchestrator.commandProcessor.store, (s) =>
      s.instances.get(brandedInstanceId),
    );

    useEffect(() => {
      if (instance && instance.vesselId !== vesselId) {
        warnOnce(
          `useActions:${instanceId}:${vesselId}`,
          `[Maelstrom] useActions: instance "${instanceId}" belongs to vessel "${instance.vesselId}", not "${vesselId}"`,
        );
      }
    }, [instance, instanceId, vesselId]);

    // TODO: Consider deferred validation (check after a timeout) for cases where
    // the instance hasn't registered yet at mount time.

    useEffect(() => {
      return orchestrator.commandProcessor.registerRunner(
        brandedInstanceId,
        runner,
      );
    }, [orchestrator, brandedInstanceId, runner]);
  };
}
