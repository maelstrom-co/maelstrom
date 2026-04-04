import { useStore } from '@tanstack/react-store';
import type { MaelstromContextPair } from './context.js';
import { createUseVesselCore } from './use-vessel-core.js';
import type {
  AnyVesselEntry,
  ExtractVesselByIdFromEntries,
  TypedVesselProps,
  VesselIds,
} from './vessel-entry-types.js';
import { warnOnce } from './warn-once.js';


/**
 * Factory that creates the m.useVessel() hook bound to a specific Maelstrom context.
 */
export function createUseVessel<const T extends readonly AnyVesselEntry[]>(
  contextPair: MaelstromContextPair,
) {
  const { useMaelstromContext } = contextPair;
  const useVesselCore = createUseVesselCore(contextPair);

  return function useVessel<Id extends VesselIds<T>>(
    vesselId: Id,
    instanceId: string,
  ): TypedVesselProps<ExtractVesselByIdFromEntries<T, Id>> | null {
    const { orchestrator } = useMaelstromContext();

    const instance = useStore(orchestrator.commandProcessor.store, (s) =>
      s.instances.get(instanceId),
    );

    const core = useVesselCore(vesselId, instanceId);

    if (!instance) return null;
    if (instance.vesselId !== vesselId) {
      warnOnce(
        `useVessel:${instanceId}:${vesselId}`,
        `[Maelstrom] useVessel: instance "${instanceId}" belongs to vessel "${instance.vesselId}", not "${vesselId}"`,
      );
      return null;
    }

    if (!core) return null;

    return {
      instanceId,
      variantProps: { variant: core.currentVariant, ...core.variantProps },
      executeAction: core.executeAction,
    } as TypedVesselProps<ExtractVesselByIdFromEntries<T, Id>>;
  };
}
