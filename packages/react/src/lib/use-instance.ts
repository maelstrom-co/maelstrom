import { InstanceId } from '@maelstrom-co/protocol';
import { useStore } from '@tanstack/react-store';

import type { MaelstromContextPair } from './context.js';
import type { UntypedVesselProps } from './dynamic-vessel-types.js';
import { createUseVesselCore } from './use-vessel-core.js';
import { warnOnce } from './warn-once.js';

/**
 * Factory that creates the m.useInstance() hook — an untyped escape hatch.
 *
 * Unlike useVessel, this hook does not require a vesselId parameter and works
 * for both statically and dynamically registered vessels. The trade-off is
 * that variantProps is `Record<string, unknown>` and action names are `string`.
 */
export function createUseInstance(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;
  const useVesselCore = createUseVesselCore(contextPair);

  return function useInstance(instanceId: string): UntypedVesselProps | null {
    const { orchestrator } = useMaelstromContext();

    // Brand once at the React seam — the hook accepts a raw string (caller
    // ergonomics) but downstream APIs are branded.
    const brandedInstanceId = InstanceId(instanceId);

    // Derive vesselId from the instance to look up the vessel definition
    const instance = useStore(orchestrator.commandProcessor.store, (s) =>
      s.instances.get(brandedInstanceId),
    );
    const vesselId = instance?.vesselId;

    const core = useVesselCore(vesselId, instanceId);

    if (!core) {
      // Instance exists but vessel definition is missing — warn once
      if (instance && vesselId) {
        warnOnce(
          `useInstance:vessel:${instance.vesselId}`,
          `[Maelstrom] useInstance: vessel "${instance.vesselId}" not found — was it registered?`,
        );
      }
      return null;
    }

    return {
      instanceId: brandedInstanceId,
      vesselId: core.vesselId,
      variantProps: { variant: core.currentVariant, ...core.variantProps },
      executeAction: core.executeAction,
    };
  };
}
